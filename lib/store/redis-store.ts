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
  inboundMessageSchema,
  type OutboundReply,
  outboundReplySchema,
  type SimulatedChannel,
  type SimulatedInvite,
  type SimulatedMessage,
  simulatedChannelSchema,
  simulatedInviteSchema,
  simulatedMessageSchema,
} from "@/lib/domain/schemas";
import { assertTransition, type DealState } from "@/lib/domain/states";
import type { GmailMessage } from "@/lib/integrations/gmail/types";
import type { RedisLike } from "./redis-like";
import type {
  AuditLog,
  DealStore,
  MailStore,
  OpportunityClaim,
  SlackSimStore,
  Store,
} from "./types";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const GLOBAL_AUDIT_RETENTION = 5000;
const DEFAULT_LIST_LIMIT = 100;

const keys = {
  auditAll: "ob:audit:all",
  auditDeal: (dealId: string) => `ob:audit:deal:${dealId}`,
  callAttempt: (dealId: string, attempt: number) =>
    `ob:call-attempt:${dealId}:${attempt}`,
  callAttemptClaim: (dealId: string, attempt: number) =>
    `ob:call-attempt-claim:${dealId}:${attempt}`,
  callEvent: (executionId: string, eventKey: string) =>
    `ob:call-event:${executionId}:${eventKey}`,
  claimMessage: (messageId: string) => `ob:claim:msg:${messageId}`,
  claimOpportunity: (opportunityId: string) => `ob:claim:opp:${opportunityId}`,
  deal: (dealId: string) => `ob:deal:${dealId}`,
  deals: "ob:deals",
  escalation: (id: string) => `ob:esc:${id}`,
  mailInbound: (messageId: string) => `ob:mail:in:${messageId}`,
  mailOutbound: (id: string) => `ob:mail:out:${id}`,
  mailPending: "ob:mail:pending",
  workflowStart: (dealId: string) => `ob:wf-start:${dealId}`,
  escalations: "ob:escalations",
  execution: (executionId: string) => `ob:exec:${executionId}`,
  slackChannel: (channelId: string) => `ob:slack:channel:${channelId}`,
  slackChannelName: (name: string) => `ob:slack:name:${name}`,
  slackChannels: "ob:slack:channels",
  slackInvites: (channelId: string) => `ob:slack:invites:${channelId}`,
  slackMessages: (channelId: string) => `ob:slack:msgs:${channelId}`,
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

  claimCallAttempt(dealId: string, attempt: number): Promise<boolean> {
    return this.redis.set(keys.callAttemptClaim(dealId, attempt), "1", {
      ex: THIRTY_DAYS_SECONDS,
      nx: true,
    });
  }

  getCallAttemptExecution(
    dealId: string,
    attempt: number
  ): Promise<string | null> {
    return this.redis.get(keys.callAttempt(dealId, attempt));
  }

  claimCallEvent(executionId: string, eventKey: string): Promise<boolean> {
    return this.redis.set(keys.callEvent(executionId, eventKey), "1", {
      ex: THIRTY_DAYS_SECONDS,
      nx: true,
    });
  }

  async createDeal(deal: DealRecord): Promise<boolean> {
    const parsed = dealRecordSchema.parse(deal);
    const written = await this.redis.set(
      keys.deal(parsed.dealId),
      JSON.stringify(parsed),
      { nx: true }
    );
    if (!written) {
      return false;
    }
    await this.redis.zadd(
      keys.deals,
      new Date(parsed.createdAt).getTime(),
      parsed.dealId
    );
    return true;
  }

  claimWorkflowStart(dealId: string, leaseSeconds: number): Promise<boolean> {
    return this.redis.set(keys.workflowStart(dealId), "1", {
      ex: leaseSeconds,
      nx: true,
    });
  }

  async releaseWorkflowStart(dealId: string): Promise<void> {
    await this.redis.del(keys.workflowStart(dealId));
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
    await this.redis.set(
      keys.callAttempt(parsed.dealId, parsed.attempt),
      parsed.executionId,
      { ex: THIRTY_DAYS_SECONDS }
    );
  }

  async getCallExecution(
    executionId: string
  ): Promise<CallExecutionMapping | null> {
    const raw = await this.redis.get(keys.execution(executionId));
    return raw ? callExecutionSchema.parse(parseJson(raw)) : null;
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

export class RedisMailStore implements MailStore {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async saveInbound(message: GmailMessage): Promise<void> {
    const parsed = inboundMessageSchema.parse(message);
    await this.redis.set(keys.mailInbound(parsed.id), JSON.stringify(parsed), {
      ex: THIRTY_DAYS_SECONDS,
    });
  }

  async getInbound(messageId: string): Promise<GmailMessage | null> {
    const raw = await this.redis.get(keys.mailInbound(messageId));
    return raw ? inboundMessageSchema.parse(parseJson(raw)) : null;
  }

  async queueReply(reply: OutboundReply): Promise<void> {
    const parsed = outboundReplySchema.parse(reply);
    await this.redis.set(keys.mailOutbound(parsed.id), JSON.stringify(parsed), {
      ex: THIRTY_DAYS_SECONDS,
    });
    await this.redis.zadd(
      keys.mailPending,
      new Date(parsed.queuedAt).getTime(),
      parsed.id
    );
  }

  async listPendingReplies(limit: number): Promise<OutboundReply[]> {
    const ids = await this.redis.zrange(keys.mailPending, 0, limit - 1);
    const raws = await this.redis.mget(ids.map((id) => keys.mailOutbound(id)));
    return raws
      .filter((raw): raw is string => raw !== null)
      .map((raw) => outboundReplySchema.parse(parseJson(raw)));
  }

  async ackReplies(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.redis.zrem(keys.mailPending, id);
    }
  }
}

export class RedisSlackSimStore implements SlackSimStore {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async createChannel(channel: SimulatedChannel): Promise<boolean> {
    const parsed = simulatedChannelSchema.parse(channel);
    // The name claim is atomic, so two deals can never both get the same channel name.
    const claimed = await this.redis.set(
      keys.slackChannelName(parsed.name),
      parsed.channelId,
      { nx: true }
    );
    if (!claimed) {
      return false;
    }
    await this.redis.set(
      keys.slackChannel(parsed.channelId),
      JSON.stringify(parsed)
    );
    await this.redis.zadd(
      keys.slackChannels,
      new Date(parsed.createdAt).getTime(),
      parsed.channelId
    );
    return true;
  }

  async getChannel(channelId: string): Promise<SimulatedChannel | null> {
    const raw = await this.redis.get(keys.slackChannel(channelId));
    return raw ? simulatedChannelSchema.parse(parseJson(raw)) : null;
  }

  async getChannelByName(name: string): Promise<SimulatedChannel | null> {
    const channelId = await this.redis.get(keys.slackChannelName(name));
    return channelId ? this.getChannel(channelId) : null;
  }

  async listChannels(): Promise<SimulatedChannel[]> {
    const ids = await this.redis.zrange(keys.slackChannels, 0, -1, {
      rev: true,
    });
    const raws = await this.redis.mget(ids.map((id) => keys.slackChannel(id)));
    return raws
      .filter((raw): raw is string => raw !== null)
      .map((raw) => simulatedChannelSchema.parse(parseJson(raw)));
  }

  async updateChannel(
    channelId: string,
    patch: Partial<Pick<SimulatedChannel, "purpose" | "topic">>
  ): Promise<void> {
    const current = await this.getChannel(channelId);
    if (!current) {
      throw new Error(`Simulated Slack channel ${channelId} not found`);
    }
    await this.redis.set(
      keys.slackChannel(channelId),
      JSON.stringify(simulatedChannelSchema.parse({ ...current, ...patch }))
    );
  }

  async appendMessage(message: SimulatedMessage): Promise<void> {
    const parsed = simulatedMessageSchema.parse(message);
    await this.redis.rpush(
      keys.slackMessages(parsed.channelId),
      JSON.stringify(parsed)
    );
  }

  async listMessages(channelId: string): Promise<SimulatedMessage[]> {
    const raws = await this.redis.lrange(keys.slackMessages(channelId), 0, -1);
    return raws.map((raw) => simulatedMessageSchema.parse(parseJson(raw)));
  }

  async recordInvite(invite: SimulatedInvite): Promise<void> {
    const parsed = simulatedInviteSchema.parse(invite);
    await this.redis.rpush(
      keys.slackInvites(parsed.channelId),
      JSON.stringify(parsed)
    );
  }

  async listInvites(channelId: string): Promise<SimulatedInvite[]> {
    const raws = await this.redis.lrange(keys.slackInvites(channelId), 0, -1);
    return raws.map((raw) => simulatedInviteSchema.parse(parseJson(raw)));
  }
}

export function createRedisStore(
  redis: RedisLike,
  clock: Clock = () => new Date()
): Store {
  return {
    audit: new RedisAuditLog(redis),
    deals: new RedisDealStore(redis, clock),
    mail: new RedisMailStore(redis),
    slack: new RedisSlackSimStore(redis),
  };
}
