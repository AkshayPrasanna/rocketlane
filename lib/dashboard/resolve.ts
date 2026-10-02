import { Auditor } from "@/lib/audit";
import type { Escalation } from "@/lib/domain/schemas";
import type { Store } from "@/lib/store/types";

/**
 * Marks an escalation as handled and records who did it. The queue entry and the deal's audit
 * trail both show the resolution, so a human decision is as visible as an agent's.
 */
export async function resolveEscalation(
  store: Store,
  escalationId: string,
  resolvedBy: string,
  options: { clock?: () => Date; newId?: () => string } = {}
): Promise<Escalation | null> {
  const resolved = await store.deals.resolveEscalation(
    escalationId,
    resolvedBy
  );
  if (!resolved) {
    return null;
  }
  const deal = await store.deals.getDeal(resolved.dealId);
  await new Auditor(
    store.audit,
    { agent: "human", dealId: resolved.dealId, runId: deal?.runId ?? null },
    options
  ).record({
    input: { escalationId, reason: resolved.reason },
    outcome: "success",
    output: { resolvedAt: resolved.resolvedAt, resolvedBy },
    rationale: `${resolvedBy} marked the escalation as handled.`,
    step: "resolve_escalation",
  });
  return resolved;
}
