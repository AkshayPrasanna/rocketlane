import { evaluateCall, placeCall } from "./call-steps";
import { complete, createChannel } from "./channel-steps";
import { begin, escalateUnexpected, parseAndValidate } from "./intake-steps";
import { createProject } from "./project-step";
import type { OnboardingSteps, PipelineDeps } from "./types";

/**
 * Binds every step to its dependencies. Tests call these directly; the durable workflow
 * wraps each one in a `"use step"` function so it gets checkpointing and retries.
 */
export function createOnboardingSteps(deps: PipelineDeps): OnboardingSteps {
  return {
    begin: (dealId, workflowRunId) => begin(deps, dealId, workflowRunId),
    complete: (dealId) => complete(deps, dealId),
    createChannel: (dealId, attempt) => createChannel(deps, dealId, attempt),
    createProject: (dealId, attempt) => createProject(deps, dealId, attempt),
    escalateUnexpected: (dealId, message) =>
      escalateUnexpected(deps, dealId, message),
    evaluateCall: (dealId, attempt, executionId, timedOut) =>
      evaluateCall(deps, dealId, attempt, executionId, timedOut),
    getTimings: () =>
      Promise.resolve({
        callResultTimeoutSeconds: deps.settings.callResultTimeoutSeconds,
        callRetryDelaySeconds: deps.settings.callRetryDelaySeconds,
      }),
    parseAndValidate: (dealId) => parseAndValidate(deps, dealId),
    placeCall: (dealId, attempt) => placeCall(deps, dealId, attempt),
  };
}
