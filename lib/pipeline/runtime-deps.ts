import { buildDemoAeDirectory } from "@/config/ae-directory";
import { getEnv } from "@/lib/env";
import { createLlmEmailParser } from "@/lib/intake/llm-parser";
import { createIntegrations } from "@/lib/integrations/factory";
import { getStore } from "@/lib/store/get-store";
import { buildSettings } from "./settings";
import { createOnboardingSteps } from "./steps";
import type { OnboardingSteps, PipelineDeps } from "./types";

let cached: PipelineDeps | null = null;

/** Builds the real dependency graph from the environment, once per server process. */
export function getPipelineDeps(): PipelineDeps {
  if (cached) {
    return cached;
  }
  const env = getEnv();
  const store = getStore();
  const clock = () => new Date();
  const newId = () => crypto.randomUUID();
  const integrations = createIntegrations(env, store, { clock, newId });

  cached = {
    clock,
    directory: buildDemoAeDirectory(env.ae),
    gmail: integrations.gmail,
    newId,
    parser: createLlmEmailParser({ model: env.aiModel }),
    rocketlane: integrations.rocketlane,
    settings: buildSettings(env),
    slack: integrations.slack,
    store,
    voice: integrations.voice,
  };
  return cached;
}

export function getOnboardingSteps(): OnboardingSteps {
  return createOnboardingSteps(getPipelineDeps());
}
