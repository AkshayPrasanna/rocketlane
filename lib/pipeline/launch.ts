import { requireDeal } from "./support";
import type { PipelineDeps } from "./types";

/** Long enough for a start call to finish, short enough that a crash doesn't strand the deal. */
const START_LEASE_SECONDS = 120;

export type LaunchResult =
  | { runId: string; status: "started" }
  | { status: "already_started" };

/**
 * Starts the onboarding workflow for a deal at most once, however many deliveries, retries or
 * concurrent requests reach it. A lease decides who starts it. If starting fails the lease is
 * released, so the next delivery of the same email can try again.
 */
export async function startWorkflowOnce(
  deps: PipelineDeps,
  dealId: string,
  start: (dealId: string) => Promise<string>
): Promise<LaunchResult> {
  const deal = await requireDeal(deps, dealId);
  if (deal.workflowRunId || deal.state !== "RECEIVED") {
    return { status: "already_started" };
  }
  if (
    !(await deps.store.deals.claimWorkflowStart(dealId, START_LEASE_SECONDS))
  ) {
    return { status: "already_started" };
  }

  try {
    const runId = await start(dealId);
    await deps.store.deals.updateDeal(dealId, { workflowRunId: runId });
    return { runId, status: "started" };
  } catch (error) {
    await deps.store.deals.releaseWorkflowStart(dealId);
    throw error;
  }
}
