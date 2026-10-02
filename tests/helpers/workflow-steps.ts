import { createOnboardingSteps } from "@/lib/pipeline/steps";
import type { OnboardingSteps, PipelineDeps } from "@/lib/pipeline/types";

const STEPS_OVERRIDE = Symbol.for("novacrm.onboardingStepsOverride");
type WithOverride = typeof globalThis & {
  [STEPS_OVERRIDE]?: OnboardingSteps | undefined;
};

/** Makes the workflow's step functions use these dependencies (see workflows/onboarding/steps.ts). */
export function useStepsFor(deps: PipelineDeps | null): void {
  (globalThis as WithOverride)[STEPS_OVERRIDE] = deps
    ? createOnboardingSteps(deps)
    : undefined;
}
