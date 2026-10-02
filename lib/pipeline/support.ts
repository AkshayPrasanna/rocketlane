import { Auditor } from "@/lib/audit";
import { buildOpsAlert } from "@/lib/communication/messages";
import type {
  AuditAgent,
  DealRecord,
  EscalationReason,
} from "@/lib/domain/schemas";
import type { DealState } from "@/lib/domain/states";
import { IntegrationError } from "@/lib/integrations/errors";
import type { PipelineDeps } from "./types";

export async function requireDeal(
  deps: PipelineDeps,
  dealId: string
): Promise<DealRecord> {
  const deal = await deps.store.deals.getDeal(dealId);
  if (!deal) {
    throw new Error(`Deal ${dealId} not found`);
  }
  return deal;
}

export function auditorFor(
  deps: PipelineDeps,
  deal: Pick<DealRecord, "dealId" | "runId">,
  agent: AuditAgent
): Auditor {
  return new Auditor(
    deps.store.audit,
    { agent, dealId: deal.dealId, runId: deal.runId },
    { clock: deps.clock, newId: deps.newId }
  );
}

export function describeError(error: unknown): string {
  if (error instanceof IntegrationError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    return `${error.kind}${status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Exponential backoff, but never sooner than the provider asked for. */
export function backoffSeconds(
  attempt: number,
  baseSeconds: number,
  retryAfterMs: number | undefined
): number {
  const exponential = baseSeconds * 2 ** (attempt - 1);
  return Math.max(exponential, Math.ceil((retryAfterMs ?? 0) / 1000));
}

export interface EscalationRequest {
  agent: AuditAgent;
  dealId: string;
  detail: string;
  input?: unknown;
  rationale: string;
  reason: EscalationReason;
  step: string;
  toState: Extract<
    DealState,
    "ESCALATED_TO_HUMAN" | "DUPLICATE_BLOCKED" | "ROCKETLANE_FAILED"
  >;
}

/**
 * The one human-escalation path. Moves the deal to its stopped state, puts it in the
 * escalation queue shown on the dashboard, alerts the ops Slack channel, and audits it.
 * A failed alert never hides the escalation: the queue entry is written regardless.
 */
export async function escalate(
  deps: PipelineDeps,
  request: EscalationRequest
): Promise<void> {
  const deal = await requireDeal(deps, request.dealId);
  const auditor = auditorFor(deps, deal, request.agent);

  const current =
    deal.state === request.toState
      ? deal
      : await deps.store.deals.transitionDeal(request.dealId, request.toState, {
          stateReason: request.detail,
        });

  let opsNotified = false;
  const { opsChannelId } = deps.settings;
  if (opsChannelId) {
    try {
      await deps.slack.postMessage(
        opsChannelId,
        buildOpsAlert({
          appUrl: deps.settings.appUrl,
          customerName: current.parsed?.customerName ?? null,
          dealId: current.dealId,
          detail: request.detail,
          reason: request.reason,
          state: current.state,
        })
      );
      opsNotified = true;
    } catch (error) {
      await auditor.record({
        input: { channel: "ops" },
        outcome: "failure",
        output: { error: describeError(error) },
        rationale:
          "Could not post the ops alert. The escalation is still queued on the dashboard.",
        step: "ops_alert",
      });
    }
  }

  await deps.store.deals.createEscalation({
    createdAt: deps.clock().toISOString(),
    dealId: current.dealId,
    detail: request.detail,
    id: deps.newId(),
    opsNotified,
    reason: request.reason,
    resolvedAt: null,
    resolvedBy: null,
  });

  await auditor.record({
    input: request.input ?? null,
    outcome: "escalated",
    output: {
      detail: request.detail,
      opsNotified,
      reason: request.reason,
      state: current.state,
    },
    rationale: request.rationale,
    step: request.step,
  });
}
