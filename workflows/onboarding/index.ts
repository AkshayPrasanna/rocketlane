import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { runOnboarding } from "@/lib/pipeline/orchestrator";
import type {
  CallWaiter,
  OnboardingOutcome,
  OnboardingSteps,
  PipelineRuntime,
} from "@/lib/pipeline/types";
import {
  stepBegin,
  stepComplete,
  stepCreateChannel,
  stepCreateProject,
  stepEscalateUnexpected,
  stepEvaluateCall,
  stepGetTimings,
  stepParseAndValidate,
  stepPlaceCall,
} from "./steps";

/** What the voice webhook sends to wake the workflow. The result itself is pulled, not pushed. */
export interface CallSignal {
  executionId: string;
}

const steps: OnboardingSteps = {
  begin: stepBegin,
  complete: stepComplete,
  createChannel: stepCreateChannel,
  createProject: stepCreateProject,
  escalateUnexpected: stepEscalateUnexpected,
  evaluateCall: stepEvaluateCall,
  getTimings: stepGetTimings,
  parseAndValidate: stepParseAndValidate,
  placeCall: stepPlaceCall,
};

/**
 * The durable primitives. A hook wakes the workflow when the voice provider's webhook
 * arrives, and it races a timer so a lost webhook cannot stall a deal: on timeout the
 * evaluate step pulls the call result from the provider directly.
 */
const runtime: PipelineRuntime = {
  openCallWaiter({ hookToken }): CallWaiter {
    const hook = createHook<CallSignal>({ token: hookToken });
    return {
      dispose: () => hook.dispose(),
      async wait(timeoutSeconds) {
        const outcome = await Promise.race([
          hook.then(() => "signal" as const),
          sleep(`${timeoutSeconds}s`).then(() => "timeout" as const),
        ]);
        return { timedOut: outcome === "timeout" };
      },
    };
  },
  sleep: (seconds) => sleep(`${seconds}s`),
};

/** One run per deal, started right after the email is registered. */
export async function onboardingWorkflow(input: {
  dealId: string;
}): Promise<OnboardingOutcome> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  return await runOnboarding(
    { dealId: input.dealId, workflowRunId },
    steps,
    runtime
  );
}
