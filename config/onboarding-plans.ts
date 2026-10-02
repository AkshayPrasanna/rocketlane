import type { PlanTier } from "@/lib/domain/schemas";

export const PHASE_NAMES = [
  "Kickoff",
  "Data Migration",
  "Configuration",
  "Go-Live",
] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

/** Target window for a phase, as day offsets from the project start date (inclusive). */
export interface PhaseWindow {
  endDay: number;
  name: PhaseName;
  startDay: number;
}

export interface OnboardingPlan {
  csm: { defaultName: string; kind: "dedicated" | "pooled" };
  durationDays: number;
  label: "Enterprise" | "Growth";
  phases: readonly PhaseWindow[];
  /** Name the template must have in Rocketlane. The ID comes from env (see settings). */
  templateName: string;
  tier: PlanTier;
}

/**
 * The single source of truth for what each plan means. The record is typed over every
 * PlanTier, so adding a tier without defining its plan is a compile error, and the
 * tier-to-template mapping can never fall through to a default.
 *
 * Phase windows are an assumption (the brief gives only the totals); keep them in sync
 * with docs/rocketlane-template-spec.md.
 */
export const ONBOARDING_PLANS: Record<PlanTier, OnboardingPlan> = {
  enterprise: {
    csm: { defaultName: "Arjun Mehta", kind: "dedicated" },
    durationDays: 30,
    label: "Enterprise",
    phases: [
      { endDay: 3, name: "Kickoff", startDay: 0 },
      { endDay: 14, name: "Data Migration", startDay: 4 },
      { endDay: 24, name: "Configuration", startDay: 15 },
      { endDay: 30, name: "Go-Live", startDay: 25 },
    ],
    templateName: "NovaCRM Enterprise Onboarding (30d)",
    tier: "enterprise",
  },
  growth: {
    csm: { defaultName: "NovaCRM Growth CS Pod", kind: "pooled" },
    durationDays: 14,
    label: "Growth",
    phases: [
      { endDay: 1, name: "Kickoff", startDay: 0 },
      { endDay: 6, name: "Data Migration", startDay: 2 },
      { endDay: 10, name: "Configuration", startDay: 7 },
      { endDay: 14, name: "Go-Live", startDay: 11 },
    ],
    templateName: "NovaCRM Growth Onboarding (14d)",
    tier: "growth",
  },
};

/** A plan with the deployment-specific values (template ID, CSM name) filled in. */
export interface ResolvedPlan extends OnboardingPlan {
  csmName: string;
  templateId: string;
}

export interface PlanOverrides {
  csmNames: Partial<Record<PlanTier, string>>;
  templateIds: Record<PlanTier, string>;
}

export function resolvePlan(
  tier: PlanTier,
  overrides: PlanOverrides
): ResolvedPlan {
  const plan = ONBOARDING_PLANS[tier];
  return {
    ...plan,
    csmName: overrides.csmNames[tier] ?? plan.csm.defaultName,
    templateId: overrides.templateIds[tier],
  };
}
