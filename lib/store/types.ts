import type {
  AuditEntry,
  CallExecutionMapping,
  DealPatch,
  DealRecord,
  Escalation,
} from "@/lib/domain/schemas";
import type { DealState } from "@/lib/domain/states";

export type OpportunityClaim =
  | { claimed: true }
  | { claimed: false; existingDealId: string };

export interface DealStore {
  /** Webhook idempotency: true the first time an (execution, event) pair is seen. */
  claimCallEvent(executionId: string, eventKey: string): Promise<boolean>;
  /** Atomically claims a Gmail message. Resolves false if it was already claimed (redelivery). */
  claimMessage(messageId: string, dealId: string): Promise<boolean>;
  /** Blocks a second flow for the same Salesforce opportunity. */
  claimOpportunity(
    opportunityId: string,
    dealId: string
  ): Promise<OpportunityClaim>;
  createDeal(deal: DealRecord): Promise<void>;
  createEscalation(escalation: Escalation): Promise<void>;
  getCallExecution(executionId: string): Promise<CallExecutionMapping | null>;
  getDeal(dealId: string): Promise<DealRecord | null>;
  getGmailHistoryId(): Promise<string | null>;
  listDeals(limit?: number): Promise<DealRecord[]>;
  listEscalations(options?: { openOnly?: boolean }): Promise<Escalation[]>;
  resolveEscalation(id: string, resolvedBy: string): Promise<Escalation | null>;
  saveCallExecution(mapping: CallExecutionMapping): Promise<void>;
  setGmailHistoryId(historyId: string): Promise<void>;
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

export interface Store {
  audit: AuditLog;
  deals: DealStore;
}
