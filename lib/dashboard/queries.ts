import { maskEmail } from "@/lib/domain/mask";
import type {
  AuditEntry,
  DealRecord,
  Escalation,
  SimulatedChannel,
  SimulatedInvite,
  SimulatedMessage,
} from "@/lib/domain/schemas";
import { NEEDS_HUMAN_STATES } from "@/lib/domain/states";
import type { Store } from "@/lib/store/types";

const DEAL_LIMIT = 100;

export interface PipelineStats {
  awaitingAe: number;
  complete: number;
  inProgress: number;
  needsHuman: number;
  total: number;
}

/** Splits deals into the four groups the overview cards show. */
export function computeStats(deals: DealRecord[]): PipelineStats {
  const stats: PipelineStats = {
    awaitingAe: 0,
    complete: 0,
    inProgress: 0,
    needsHuman: 0,
    total: deals.length,
  };
  for (const deal of deals) {
    if (deal.state === "COMPLETE") {
      stats.complete += 1;
    } else if (NEEDS_HUMAN_STATES.has(deal.state)) {
      stats.needsHuman += 1;
    } else if (deal.state === "NEEDS_CLARIFICATION") {
      stats.awaitingAe += 1;
    } else {
      stats.inProgress += 1;
    }
  }
  return stats;
}

export interface DealRow {
  aeEmail: string;
  callAttempts: number;
  customerName: string;
  deal: DealRecord;
  updatedAt: number;
}

/** The customer name once parsed; before that, the email subject is the best label there is. */
export function customerLabel(deal: DealRecord): string {
  return deal.parsed?.customerName ?? deal.subject ?? "Unparsed email";
}

export function toDealRow(deal: DealRecord): DealRow {
  return {
    aeEmail: maskEmail(deal.aeEmail ?? "unknown"),
    callAttempts: deal.callAttempts,
    customerName: customerLabel(deal),
    deal,
    updatedAt: new Date(deal.updatedAt).getTime(),
  };
}

export interface EscalationRow {
  customerName: string;
  escalation: Escalation;
}

export interface DealDetail {
  audit: AuditEntry[];
  channel: SimulatedChannel | null;
  deal: DealRecord;
  escalations: Escalation[];
  messages: SimulatedMessage[];
}

export interface SlackChannelView {
  channel: SimulatedChannel;
  invites: SimulatedInvite[];
  messages: SimulatedMessage[];
}

/** Everything the dashboard reads, behind one object so it can be tested on any store. */
export function createDashboardQueries(store: Store) {
  return {
    async dealRows(): Promise<{ rows: DealRow[]; stats: PipelineStats }> {
      const deals = await store.deals.listDeals(DEAL_LIMIT);
      return { rows: deals.map(toDealRow), stats: computeStats(deals) };
    },

    async dealDetail(dealId: string): Promise<DealDetail | null> {
      const deal = await store.deals.getDeal(dealId);
      if (!deal) {
        return null;
      }
      const [audit, escalations] = await Promise.all([
        store.audit.listByDeal(dealId),
        store.deals.listEscalations(),
      ]);
      const channel = deal.channel
        ? await store.slack.getChannel(deal.channel.channelId)
        : null;
      const messages = channel
        ? await store.slack.listMessages(channel.channelId)
        : [];
      return {
        audit,
        channel,
        deal,
        escalations: escalations.filter((e) => e.dealId === dealId),
        messages,
      };
    },

    async escalationRows(): Promise<EscalationRow[]> {
      const [escalations, deals] = await Promise.all([
        store.deals.listEscalations(),
        store.deals.listDeals(DEAL_LIMIT),
      ]);
      const byId = new Map(deals.map((deal) => [deal.dealId, deal]));
      const rows = escalations.map((escalation) => {
        const deal = byId.get(escalation.dealId);
        return {
          customerName: deal ? customerLabel(deal) : "Unknown deal",
          escalation,
        };
      });
      // Open items first, then newest first.
      return rows.sort((a, b) => {
        const open =
          Number(a.escalation.resolvedAt !== null) -
          Number(b.escalation.resolvedAt !== null);
        return (
          open || b.escalation.createdAt.localeCompare(a.escalation.createdAt)
        );
      });
    },

    async slackChannels(): Promise<SlackChannelView[]> {
      const channels = await store.slack.listChannels();
      return await Promise.all(
        channels.map(async (channel) => ({
          channel,
          invites: await store.slack.listInvites(channel.channelId),
          messages: await store.slack.listMessages(channel.channelId),
        }))
      );
    },

    async openEscalationCount(): Promise<number> {
      return (await store.deals.listEscalations({ openOnly: true })).length;
    },
  };
}
