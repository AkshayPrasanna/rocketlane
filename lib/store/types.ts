import type {
  AuditEntry,
  CallExecutionMapping,
  DealPatch,
  DealRecord,
  Escalation,
  OutboundReply,
  SimulatedChannel,
  SimulatedInvite,
  SimulatedMessage,
} from "@/lib/domain/schemas";
import type { DealState } from "@/lib/domain/states";
import type { GmailMessage } from "@/lib/integrations/gmail/types";

export type OpportunityClaim =
  | { claimed: true }
  | { claimed: false; existingDealId: string };

export interface DealStore {
  /** True the first time a dial for (deal, attempt) is attempted. Stops a retried step re-dialling. */
  claimCallAttempt(dealId: string, attempt: number): Promise<boolean>;
  /** Webhook idempotency: true the first time an (execution, event) pair is seen. */
  claimCallEvent(executionId: string, eventKey: string): Promise<boolean>;
  /** Atomically claims a Gmail message. Resolves false if it was already claimed (redelivery). */
  claimMessage(messageId: string, dealId: string): Promise<boolean>;
  claimOpportunity(
    opportunityId: string,
    dealId: string
  ): Promise<OpportunityClaim>;
  /** Blocks a second flow for the same Salesforce opportunity. */
  /**
   * A short lease that lets exactly one caller start the workflow for a deal. The lease
   * expires, so a caller that crashed before starting does not block the deal forever.
   */
  claimWorkflowStart(dealId: string, leaseSeconds: number): Promise<boolean>;
  /** Resolves false when a deal for this email already exists. */
  createDeal(deal: DealRecord): Promise<boolean>;
  createEscalation(escalation: Escalation): Promise<void>;
  getCallAttemptExecution(
    dealId: string,
    attempt: number
  ): Promise<string | null>;
  getCallExecution(executionId: string): Promise<CallExecutionMapping | null>;
  getDeal(dealId: string): Promise<DealRecord | null>;
  listDeals(limit?: number): Promise<DealRecord[]>;
  listEscalations(options?: { openOnly?: boolean }): Promise<Escalation[]>;
  releaseWorkflowStart(dealId: string): Promise<void>;
  resolveEscalation(id: string, resolvedBy: string): Promise<Escalation | null>;
  saveCallExecution(mapping: CallExecutionMapping): Promise<void>;
  /**
   * Moves a deal to a new state, rejecting illegal moves. Read-modify-write, which is safe
   * because exactly one workflow run owns a deal (guaranteed by `claimMessage`).
   */
  transitionDeal(
    dealId: string,
    to: DealState,
    patch?: DealPatch
  ): Promise<DealRecord>;
  updateDeal(dealId: string, patch: DealPatch): Promise<DealRecord>;
}

export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
  /** Everything retained, oldest first. Used by the JSONL export. */
  listAll(): Promise<AuditEntry[]>;
  listByDeal(dealId: string): Promise<AuditEntry[]>;
  /** The most recent `limit` entries, oldest first. */
  listRecent(limit: number): Promise<AuditEntry[]>;
}

export interface MailStore {
  /** Drops replies the bridge has sent. Unknown IDs are ignored, so acking twice is safe. */
  ackReplies(ids: string[]): Promise<void>;
  getInbound(messageId: string): Promise<GmailMessage | null>;
  /** Replies waiting to be sent, oldest first. */
  listPendingReplies(limit: number): Promise<OutboundReply[]>;
  queueReply(reply: OutboundReply): Promise<void>;
  saveInbound(message: GmailMessage): Promise<void>;
}

export interface SlackSimStore {
  appendMessage(message: SimulatedMessage): Promise<void>;
  /** Resolves false when the name is already taken (like Slack's name_taken). */
  createChannel(channel: SimulatedChannel): Promise<boolean>;
  getChannel(channelId: string): Promise<SimulatedChannel | null>;
  getChannelByName(name: string): Promise<SimulatedChannel | null>;
  listChannels(): Promise<SimulatedChannel[]>;
  listInvites(channelId: string): Promise<SimulatedInvite[]>;
  listMessages(channelId: string): Promise<SimulatedMessage[]>;
  recordInvite(invite: SimulatedInvite): Promise<void>;
  updateChannel(
    channelId: string,
    patch: Partial<Pick<SimulatedChannel, "purpose" | "topic">>
  ): Promise<void>;
}

export interface Store {
  audit: AuditLog;
  deals: DealStore;
  mail: MailStore;
  slack: SlackSimStore;
}
