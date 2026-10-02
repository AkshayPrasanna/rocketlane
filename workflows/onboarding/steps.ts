import type {
  ChannelStepResult,
  EvaluateCallStepResult,
  OnboardingSteps,
  ParseStepResult,
  PlaceCallStepResult,
  ProjectStepResult,
  Timings,
} from "@/lib/pipeline/types";

/*
 * Each step is a thin "use step" wrapper around the real, idempotent step functions. Steps
 * run in the full Node runtime and retry up to three times on unexpected errors. That is safe
 * because every step resumes from the deal's persisted state and never repeats a side effect.
 */

/*
 * Integration tests run the real Workflow runtime in-process, where this file is loaded by
 * Node directly and cannot resolve the app's path aliases. They hand in prebuilt steps through
 * this global instead. In the app, the dependencies are loaded on first use.
 */
const STEPS_OVERRIDE = Symbol.for("novacrm.onboardingStepsOverride");

async function loadSteps(): Promise<OnboardingSteps> {
  const override = (
    globalThis as { [STEPS_OVERRIDE]?: OnboardingSteps | undefined }
  )[STEPS_OVERRIDE];
  if (override) {
    return override;
  }
  const { getOnboardingSteps } = await import("@/lib/pipeline/runtime-deps");
  return getOnboardingSteps();
}

export async function stepBegin(
  dealId: string,
  workflowRunId: string
): Promise<void> {
  "use step";
  await (await loadSteps()).begin(dealId, workflowRunId);
}

export async function stepParseAndValidate(
  dealId: string
): Promise<ParseStepResult> {
  "use step";
  return await (await loadSteps()).parseAndValidate(dealId);
}

export async function stepGetTimings(): Promise<Timings> {
  "use step";
  return await (await loadSteps()).getTimings();
}

export async function stepPlaceCall(
  dealId: string,
  attempt: number
): Promise<PlaceCallStepResult> {
  "use step";
  return await (await loadSteps()).placeCall(dealId, attempt);
}

export async function stepEvaluateCall(
  dealId: string,
  attempt: number,
  executionId: string,
  timedOut: boolean
): Promise<EvaluateCallStepResult> {
  "use step";
  return await (await loadSteps()).evaluateCall(
    dealId,
    attempt,
    executionId,
    timedOut
  );
}

export async function stepCreateProject(
  dealId: string,
  attempt: number
): Promise<ProjectStepResult> {
  "use step";
  return await (await loadSteps()).createProject(dealId, attempt);
}

export async function stepCreateChannel(
  dealId: string,
  attempt: number
): Promise<ChannelStepResult> {
  "use step";
  return await (await loadSteps()).createChannel(dealId, attempt);
}

export async function stepComplete(dealId: string): Promise<void> {
  "use step";
  await (await loadSteps()).complete(dealId);
}

export async function stepEscalateUnexpected(
  dealId: string,
  message: string
): Promise<void> {
  "use step";
  await (await loadSteps()).escalateUnexpected(dealId, message);
}
