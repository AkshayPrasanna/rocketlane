import { maskDeep } from "@/lib/domain/mask";
import type {
  AuditAgent,
  AuditEntry,
  AuditOutcome,
} from "@/lib/domain/schemas";
import type { AuditLog } from "@/lib/store/types";

export interface AuditContext {
  agent: AuditAgent;
  dealId: string | null;
  runId: string | null;
}

export interface AuditRecord {
  input?: unknown;
  outcome: AuditOutcome;
  output?: unknown;
  /** Why the system decided what it did. Required: the log must explain, not just record. */
  rationale: string;
  step: string;
}

/**
 * Writes one audit entry per agent action. Inputs and outputs are PII-masked and length
 * capped before they reach the store, so nothing downstream has to remember to do it.
 */
export class Auditor {
  readonly context: AuditContext;
  private readonly log: AuditLog;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(
    log: AuditLog,
    context: AuditContext,
    options: { clock?: () => Date; newId?: () => string } = {}
  ) {
    this.log = log;
    this.context = context;
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Same log and clock, different attribution (e.g. switching from intake to communication). */
  with(context: Partial<AuditContext>): Auditor {
    return new Auditor(
      this.log,
      { ...this.context, ...context },
      { clock: this.clock, newId: this.newId }
    );
  }

  async record(record: AuditRecord): Promise<AuditEntry> {
    const entry: AuditEntry = {
      agent: this.context.agent,
      dealId: this.context.dealId,
      id: this.newId(),
      input: maskDeep(record.input),
      outcome: record.outcome,
      output: maskDeep(record.output),
      rationale: record.rationale,
      runId: this.context.runId,
      step: record.step,
      timestamp: this.clock().toISOString(),
    };
    await this.log.append(entry);
    return entry;
  }
}
