import type { PlanTier } from "@/lib/domain/schemas";
import { callHookToken } from "./call-hook";
import type {
  CallWaiter,
  ChannelStepResult,
  OnboardingOutcome,
  OnboardingSteps,
  PipelineRuntime,
  ProjectStepResult,
  Timings,
} from "./types";

/**
 * Hard ceilings so a misbehaving step can never turn into an endless dialling or retry
 * loop. The real limits come from settings and are far lower.
 */
const HARD_ATTEMPT_CEILING = 10;
const MAX_PENDING_CHECKS = 5;

type TierResult = { tier: PlanTier } | { stopped: OnboardingOutcome };

/**
 * Pure control flow: which step runs next, when to wait, when to stop. It does no I/O and
 * holds no secrets, so it can run inside Vercel Workflow's deterministic sandbox or, in
 * tests, straight through with instant waits. Every side effect lives in a step.
 */
export async function runOnboarding(
  input: { dealId: string; workflowRunId: string },
  steps: OnboardingSteps,
  runtime: PipelineRuntime
): Promise<OnboardingOutcome> {
  const { dealId, workflowRunId } = input;

  try {
    await steps.begin(dealId, workflowRunId);

    const intake = await steps.parseAndValidate(dealId);
    if (intake.status === "needs_clarification") {
      return "NEEDS_CLARIFICATION";
    }
    if (intake.status === "duplicate_opportunity") {
      return "DUPLICATE_BLOCKED";
    }
    if (intake.status === "escalated") {
      return "ESCALATED_TO_HUMAN";
    }

    const timings = await steps.getTimings();
    const tier = await confirmTier(dealId, steps, runtime, timings);
    if ("stopped" in tier) {
      return tier.stopped;
    }

    const project = await createProjectWithRetries(dealId, steps, runtime);
    if (project.status === "blocked_duplicate") {
      return "DUPLICATE_BLOCKED";
    }
    if (project.status === "failed") {
      return "ROCKETLANE_FAILED";
    }

    const channel = await createChannelWithRetries(dealId, steps, runtime);
    if (channel.status === "failed") {
      return "ESCALATED_TO_HUMAN";
    }

    await steps.complete(dealId);
    return "COMPLETE";
  } catch (error) {
    await steps.escalateUnexpected(
      dealId,
      error instanceof Error ? error.message : String(error)
    );
    return "ESCALATED_TO_HUMAN";
  }
}

/** Retries project creation, sleeping for the delay the step asks for between attempts. */
async function createProjectWithRetries(
  dealId: string,
  steps: OnboardingSteps,
  runtime: PipelineRuntime
): Promise<Exclude<ProjectStepResult, { status: "retry" }>> {
  for (let attempt = 1; attempt <= HARD_ATTEMPT_CEILING; attempt++) {
    const result = await steps.createProject(dealId, attempt);
    if (result.status !== "retry") {
      return result;
    }
    await runtime.sleep(result.delaySeconds);
  }
  throw new Error(
    "Project creation retry ceiling reached without a final result"
  );
}

async function createChannelWithRetries(
  dealId: string,
  steps: OnboardingSteps,
  runtime: PipelineRuntime
): Promise<Exclude<ChannelStepResult, { status: "retry" }>> {
  for (let attempt = 1; attempt <= HARD_ATTEMPT_CEILING; attempt++) {
    const result = await steps.createChannel(dealId, attempt);
    if (result.status !== "retry") {
      return result;
    }
    await runtime.sleep(result.delaySeconds);
  }
  throw new Error(
    "Channel creation retry ceiling reached without a final result"
  );
}

/** Dials the AE until the tier is clearly confirmed, retries run out, or a human is needed. */
async function confirmTier(
  dealId: string,
  steps: OnboardingSteps,
  runtime: PipelineRuntime,
  timings: Timings
): Promise<TierResult> {
  for (let attempt = 1; attempt <= HARD_ATTEMPT_CEILING; attempt++) {
    // Open the hook first, so even an instant webhook cannot be missed.
    const waiter = runtime.openCallWaiter({
      attempt,
      dealId,
      hookToken: callHookToken(dealId, attempt),
    });

    try {
      const dial = await steps.placeCall(dealId, attempt);
      if (dial.status === "escalated") {
        return { stopped: "ESCALATED_TO_HUMAN" };
      }

      if (dial.status === "dialed") {
        const evaluation = await awaitEvaluation(
          { attempt, dealId, executionId: dial.executionId, timings },
          steps,
          waiter
        );
        if (evaluation.status === "confirmed") {
          return { tier: evaluation.tier };
        }
        if (evaluation.status === "escalated") {
          return { stopped: "ESCALATED_TO_HUMAN" };
        }
      }
    } finally {
      waiter.dispose();
    }

    await runtime.sleep(timings.callRetryDelaySeconds);
  }
  throw new Error("Call attempt ceiling reached without a decision");
}

async function awaitEvaluation(
  call: {
    attempt: number;
    dealId: string;
    executionId: string;
    timings: Timings;
  },
  steps: OnboardingSteps,
  waiter: CallWaiter
) {
  let timedOut = false;
  for (let check = 0; check < MAX_PENDING_CHECKS; check++) {
    const waited = await waiter.wait(call.timings.callResultTimeoutSeconds);
    timedOut = waited.timedOut || check === MAX_PENDING_CHECKS - 1;
    const evaluation = await steps.evaluateCall(
      call.dealId,
      call.attempt,
      call.executionId,
      timedOut
    );
    if (evaluation.status !== "pending") {
      return evaluation;
    }
  }
  return await steps.evaluateCall(
    call.dealId,
    call.attempt,
    call.executionId,
    true
  );
}
