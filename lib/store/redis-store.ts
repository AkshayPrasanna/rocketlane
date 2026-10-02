import {
  type AuditEntry,
  auditEntrySchema,
  type CallExecutionMapping,
  callExecutionSchema,
  type DealPatch,
  type DealRecord,
  dealRecordSchema,
  type Escalation,
  escalationSchema,
} from "@/lib/domain/schemas";
import { assertTransition, type DealState } from "@/lib/domain/states";
import type { RedisLike } from "./redis-like";
import type { AuditLog, DealStore, OpportunityClaim, Store } from "./types";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const GLOBAL_AUDIT_RETENTION = 5000;
const DEFAULT_LIST_LIMIT = 100;

const keys = {
  auditAll: "ob:audit:all",
  auditDeal: (dealId: string) => `ob:audit:deal:${dealId}`,
  callEvent: (executionId: string, eventKey: string) =>
    `ob:call-event:${executionId}:${eventKey}`,
  claimMessage: (messageId: string) => `ob:claim:msg:${messageId}`,
  claimOpportunity: (opportunityId: string) => `ob:claim:opp:${opportunityId}`,
  deal: (dealId: string) => `ob:deal:${dealId}`,
  deals: "ob:deals",
  escalation: (id: string) => `ob:esc:${id}`,
  escalations: "ob:escalations",
  execution: (executionId: string) => `ob:exec:${executionId}`,
  gmailHistoryId: "ob:gmail:history-id",
} as const;

type Clock = () => Date;

function parseJson(raw: string): unknown {
  return JSON.parse(raw);
}

export class RedisDealStore implements DealStore {
  private readonly redis: RedisLike;
  private readonly clock: Clock;

  constructor(redis: RedisLike, clock: Clock) {
    this.redis = redis;
    this.clock = clock;
  }

  claimMessage(messageId: string, dealId: string): Promise<boolean> {
    return this.redis.set(keys.claimMessage(messageId), dealId, {
      ex: THIRTY_DAYS_SECONDS,
      nx: true,
    });
  }

  async claimOpportunity(
    opportunityId: string,
    dealId: string
  ): Promise<OpportunityClaim> {
    const key = keys.claimOpportunity(opportunityId);
    const written = await this.redis.set(key, dealId, { nx: true });
    if (written) {
      return { claimed: true };
    }
    const existing = await this.redis.get(key);
    if (existing === dealId) {
      return { claimed: true };
    }
    return { claimed: false, existingDealId: existing ?? "unknown" };
  }

  claimCallEvent(executionId: string, eventKey: string): Promise<boolean> {
    return this.redis.set(keys.callEvent(executionId, eventKey), "1", {
      ex: THIRTY_DAYS_SECONDS,
      nx: true,
    });
  }

  async createDeal(deal: DealRecord): Promise<void> {
    const parsed = dealRecordSchema.parse(deal);
    const written = await this.redis.set(
      keys.deal(parsed.dealId),
      JSON.stringify(parsed),
      { nx: true }
    );
    if (!written) {
      throw new Error(`Deal ${parsed.dealId} already exists`);
    }
    await this.redis.zadd(
      keys.deals,
      new Date(parsed.createdAt).getTime(),
      parsed.dealId
    );
  }

  async getDeal(dealId: string): Promise<DealRecord | null> {
    const raw = await this.redis.get(keys.deal(dealId));
    return raw ? dealRecordSchema.parse(parseJson(raw)) : null;
  }

  async listDeals(limit = DEFAULT_LIST_LIMIT): Promise<DealRecord[]> {
    const ids = await this.redis.zrange(keys.deals, 0, limit - 1, {
      rev: true,
    });
    const raws = await this.redis.mget(ids.map((id) => keys.deal(id)));
    return raws
      .filter((raw): raw is string => raw !== null)
      .map((raw) => dealRecordSchema.parse(parseJson(raw)));
  }

  async updateDeal(dealId: string, patch: DealPatch): Promise<DealRecord> {
    const current = await this.requireDeal(dealId);
    return this.write({ ...current, ...patch });
  }

  async transitionDeal(
    dealId: string,
    to: DealState,
    patch: DealPatch = {}
  ): Promise<DealRecord> {
    const current = await this.requireDeal(dealId);
    assertTransition(current.state, to);
    return this.write({ ...current, ...patch, state: to });
  }

  async createEscalation(escalation: Escalation): Promise<void> {
    const parsed = escalationSchema.parse(escalation);
    await this.redis.set(keys.escalation(parsed.id), JSON.stringify(parsed));
    await this.redis.zadd(
      keys.escalations,
      new Date(parsed.createdAt).getTime(),
      parsed.id
    );
  }

  async listEscalations(
    options: { openOnly?: boolean } = {}
  ): Promise<Escalation[]> {
    const ids = await this.redis.zrange(keys.escalations, 0, -1, {
      rev: true,
    });
    const raws = await this.redis.mget(ids.map((id) => keys.escalation(id)));
    const all = raws
      .filter((raw): raw is string => raw !== null)
      .map((raw) => escalationSchema.parse(parseJson(raw)));
    return options.openOnly ? all.filter((e) => e.resolvedAt === null) : all;
  }

  async resolveEscalation(
    id: string,
    resolvedBy: string
  ): Promise<Escalation | null> {
    const raw = await this.redis.get(keys.escalation(id));
    if (!raw) {
      return null;
    }
    const current = escalationSchema.parse(parseJson(raw));
    if (current.resolvedAt) {
      return current;
    }
    const resolved: Escalation = {
      ...current,
      resolvedAt: this.clock().toISOString(),
      resolvedBy,
    };
    await this.redis.set(keys.escalation(id), JSON.stringify(resolved));
    return resolved;
  }

  async saveCallExecution(mapping: CallExecutionMapping): Promise<void> {
    const parsed = callExecutionSchema.parse(mapping);
    await this.redis.set(
      keys.execution(parsed.executionId),
      JSON.stringify(parsed),
      { ex: THIRTY_DAYS_SECONDS }
    );
  }

  async getCallExecution(
    executionId: string
  ): Promise<CallExecutionMapping | null> {
    const raw = await this.redis.get(keys.execution(executionId));
    return raw ? callExecutionSchema.parse(parseJson(raw)) : null;
  }

  getGmailHistoryId(): Promise<string | null> {
    return this.redis.get(keys.gmailHistoryId);
  }

  async setGmailHistoryId(historyId: string): Promise<void> {
    await this.redis.set(keys.gmailHistoryId, historyId);
  }

  private async requireDeal(dealId: string): Promise<DealRecord> {
    const deal = await this.getDeal(dealId);
    if (!deal) {
      throw new Error(`Deal ${dealId} not found`);
    }
    return deal;
  }

  private async write(next: DealRecord): Promise<DealRecord> {
    const updated = dealRecordSchema.parse({
      ...next,
      updatedAt: this.clock().toISOString(),
    });
    await this.redis.set(keys.deal(updated.dealId), JSON.stringify(updated));
    return updated;
  }
}

export class RedisAuditLog implements AuditLog {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async append(entry: AuditEntry): Promise<void> {
    const parsed = auditEntrySchema.parse(entry);
    const json = JSON.stringify(parsed);
    await this.redis.rpush(keys.auditAll, json);
    await this.redis.ltrim(keys.auditAll, -GLOBAL_AUDIT_RETENTION, -1);
    if (parsed.dealId) {
      await this.redis.rpush(keys.auditDeal(parsed.dealId), json);
    }
  }

  listAll(): Promise<AuditEntry[]> {
    return this.read(keys.auditAll, 0, -1);
  }

  listByDeal(dealId: string): Promise<AuditEntry[]> {
    return this.read(keys.auditDeal(dealId), 0, -1);
  }

  listRecent(limit: number): Promise<AuditEntry[]> {
    return this.read(keys.auditAll, -limit, -1);
  }

  private async read(
    key: string,
    start: number,
    stop: number
  ): Promise<AuditEntry[]> {
    const raws = await this.redis.lrange(key, start, stop);
    return raws.map((raw) => auditEntrySchema.parse(parseJson(raw)));
  }
}

export function createRedisStore(
  redis: RedisLike,
  clock: Clock = () => new Date()
): Store {
  return {
    audit: new RedisAuditLog(redis),
    deals: new RedisDealStore(redis, clock),
  };
}
