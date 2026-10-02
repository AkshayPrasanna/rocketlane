import { type ResolvedPlan, resolvePlan } from "@/config/onboarding-plans";
import type { PlanTier } from "@/lib/domain/schemas";
import type { Env } from "@/lib/env";

export interface PipelineSettings {
  appUrl: string | null;
  callResultTimeoutSeconds: number;
  callRetryDelaySeconds: number;
  gmailProcessedLabel: string;
  maxCallAttempts: number;
  opsChannelId: string | null;
  plans: Record<PlanTier, ResolvedPlan>;
  /** Bounded retry for Rocketlane and Slack calls that fail with a retryable error. */
  retry: { baseDelaySeconds: number; maxAttempts: number };
  rocketlaneOwnerEmail: string;
  timeZone: string;
}

const MOCK_TEMPLATE_IDS: Record<PlanTier, string> = {
  enterprise: "mock-template-enterprise",
  growth: "mock-template-growth",
};
const MOCK_OWNER_EMAIL = "owner@mock.test";
export const SIMULATED_OPS_CHANNEL = "ops-escalations";

/**
 * Templates are what get mixed up in the manual process, so the two IDs are checked here:
 * both must exist and they must differ. A deployment that points both tiers at one template
 * fails at startup, not on the first customer.
 */
export function assertDistinctTemplates(
  plans: Record<PlanTier, ResolvedPlan>
): void {
  if (plans.enterprise.templateId === plans.growth.templateId) {
    throw new Error(
      "ROCKETLANE_TEMPLATE_ID_ENTERPRISE and ROCKETLANE_TEMPLATE_ID_GROWTH must be different templates"
    );
  }
}

export function buildSettings(env: Env): PipelineSettings {
  const live = env.modes.rocketlane === "live";
  const { enterprise, growth } = env.rocketlane.templateIds;

  if (live && !(enterprise && growth && env.rocketlane.ownerEmail)) {
    throw new Error(
      "ROCKETLANE_MODE=live requires ROCKETLANE_TEMPLATE_ID_ENTERPRISE, ROCKETLANE_TEMPLATE_ID_GROWTH and ROCKETLANE_OWNER_EMAIL"
    );
  }

  const overrides = {
    csmNames: {
      enterprise: env.csmNames.enterprise,
      growth: env.csmNames.growth,
    },
    templateIds: {
      enterprise: enterprise ?? MOCK_TEMPLATE_IDS.enterprise,
      growth: growth ?? MOCK_TEMPLATE_IDS.growth,
    },
  };
  const plans = {
    enterprise: resolvePlan("enterprise", overrides),
    growth: resolvePlan("growth", overrides),
  };
  assertDistinctTemplates(plans);

  return {
    appUrl: env.appUrl ?? null,
    callResultTimeoutSeconds: env.call.resultTimeoutSeconds,
    callRetryDelaySeconds: env.call.retryDelaySeconds,
    gmailProcessedLabel: env.gmailProcessedLabel,
    maxCallAttempts: env.call.maxAttempts,
    // With Slack simulated, escalation alerts still need somewhere to land.
    opsChannelId:
      env.opsSlackChannelId ??
      (env.modes.slack === "mock" ? SIMULATED_OPS_CHANNEL : null),
    plans,
    retry: env.retry,
    rocketlaneOwnerEmail: env.rocketlane.ownerEmail ?? MOCK_OWNER_EMAIL,
    timeZone: env.onboardingTimeZone,
  };
}
