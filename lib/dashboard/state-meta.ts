import type { DealRecord } from "@/lib/domain/schemas";
import { type DealState, NEEDS_HUMAN_STATES } from "@/lib/domain/states";

export type Tone = "neutral" | "progress" | "success" | "warning" | "danger";

export interface StateMeta {
  hint: string;
  label: string;
  tone: Tone;
}

export const STATE_META: Record<DealState, StateMeta> = {
  CALLING_AE: {
    hint: "A voice call to the AE is in progress",
    label: "Calling AE",
    tone: "progress",
  },
  CALL_RETRY: {
    hint: "The last call did not confirm a plan; waiting to retry",
    label: "Retrying call",
    tone: "warning",
  },
  CHANNEL_CREATED: {
    hint: "The customer Slack channel is ready",
    label: "Channel created",
    tone: "progress",
  },
  COMPLETE: {
    hint: "Project and Slack channel are created",
    label: "Complete",
    tone: "success",
  },
  DUPLICATE_BLOCKED: {
    hint: "A project already exists, so nothing was created",
    label: "Duplicate blocked",
    tone: "danger",
  },
  ESCALATED_TO_HUMAN: {
    hint: "The system stopped and handed this deal to a person",
    label: "Escalated",
    tone: "danger",
  },
  NEEDS_CLARIFICATION: {
    hint: "Required fields were missing; the AE was asked to resend",
    label: "Needs clarification",
    tone: "warning",
  },
  PARSED: {
    hint: "Fields were extracted from the email",
    label: "Parsed",
    tone: "progress",
  },
  PROJECT_CREATED: {
    hint: "The Rocketlane project is created",
    label: "Project created",
    tone: "progress",
  },
  RECEIVED: {
    hint: "The email was received",
    label: "Received",
    tone: "neutral",
  },
  ROCKETLANE_FAILED: {
    hint: "Rocketlane could not create the project after retries",
    label: "Rocketlane failed",
    tone: "danger",
  },
  TIER_CONFIRMED: {
    hint: "The AE confirmed the plan tier by phone",
    label: "Tier confirmed",
    tone: "progress",
  },
  VALIDATED: {
    hint: "All required fields are present and verified",
    label: "Validated",
    tone: "progress",
  },
};

/** The happy path, in order. Every deal is shown against it. */
export const MAIN_PATH = [
  { label: "Received", state: "RECEIVED" },
  { label: "Parsed", state: "PARSED" },
  { label: "Validated", state: "VALIDATED" },
  { label: "AE called", state: "CALLING_AE" },
  { label: "Tier confirmed", state: "TIER_CONFIRMED" },
  { label: "Project created", state: "PROJECT_CREATED" },
  { label: "Slack channel", state: "CHANNEL_CREATED" },
  { label: "Complete", state: "COMPLETE" },
] as const;

export type StepStatus = "done" | "current" | "pending" | "stopped";

export interface ProgressStep {
  label: string;
  status: StepStatus;
}

/** States where the pipeline will not move on without a person. */
const STOPPED_STATES: ReadonlySet<DealState> = new Set([
  ...NEEDS_HUMAN_STATES,
  "NEEDS_CLARIFICATION",
]);

/** Which main-path milestones the deal has actually reached, judged from its own data. */
function reached(deal: DealRecord): boolean[] {
  return [
    true,
    deal.parsed !== null,
    deal.parsed?.opportunityId != null,
    deal.callAttempts > 0,
    deal.planTier !== null,
    deal.project !== null,
    deal.state === "CHANNEL_CREATED" || deal.state === "COMPLETE",
    deal.state === "COMPLETE",
  ];
}

/**
 * Shows how far a deal got along the happy path. A deal that stopped (escalated, blocked,
 * waiting on the AE) shows the step it stopped at, so the failure is easy to point at.
 */
export function buildProgress(deal: DealRecord): ProgressStep[] {
  const flags = reached(deal);
  const firstPending = flags.indexOf(false);
  const stopped = STOPPED_STATES.has(deal.state);

  return MAIN_PATH.map((step, index) => {
    if (flags[index]) {
      return { label: step.label, status: "done" };
    }
    if (index === firstPending) {
      return { label: step.label, status: stopped ? "stopped" : "current" };
    }
    return { label: step.label, status: "pending" };
  });
}

export function needsAttention(state: DealState): boolean {
  return STOPPED_STATES.has(state);
}
