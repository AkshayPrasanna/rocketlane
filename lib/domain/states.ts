import { z } from "zod";

export const DEAL_STATES = [
  "RECEIVED",
  "PARSED",
  "NEEDS_CLARIFICATION",
  "VALIDATED",
  "CALLING_AE",
  "CALL_RETRY",
  "TIER_CONFIRMED",
  "PROJECT_CREATED",
  "DUPLICATE_BLOCKED",
  "ROCKETLANE_FAILED",
  "CHANNEL_CREATED",
  "ESCALATED_TO_HUMAN",
  "COMPLETE",
] as const;

export const dealStateSchema = z.enum(DEAL_STATES);
export type DealState = z.infer<typeof dealStateSchema>;

/**
 * The only legal moves. Anything else is a bug, and `assertTransition` refuses it,
 * so no code path can, for example, jump from VALIDATED straight to PROJECT_CREATED
 * without a confirmed tier.
 */
const TRANSITIONS: Record<DealState, readonly DealState[]> = {
  RECEIVED: ["PARSED", "ESCALATED_TO_HUMAN"],
  PARSED: ["VALIDATED", "NEEDS_CLARIFICATION"],
  // Re-entry happens only when the AE replies in-thread with the missing fields.
  NEEDS_CLARIFICATION: ["PARSED"],
  VALIDATED: ["CALLING_AE", "ESCALATED_TO_HUMAN"],
  CALLING_AE: ["TIER_CONFIRMED", "CALL_RETRY", "ESCALATED_TO_HUMAN"],
  CALL_RETRY: ["CALLING_AE", "ESCALATED_TO_HUMAN"],
  TIER_CONFIRMED: ["PROJECT_CREATED", "DUPLICATE_BLOCKED", "ROCKETLANE_FAILED"],
  PROJECT_CREATED: ["CHANNEL_CREATED", "ESCALATED_TO_HUMAN"],
  CHANNEL_CREATED: ["COMPLETE", "ESCALATED_TO_HUMAN"],
  DUPLICATE_BLOCKED: [],
  ROCKETLANE_FAILED: [],
  ESCALATED_TO_HUMAN: [],
  COMPLETE: [],
};

/** States where the pipeline has stopped for good and a human owns what happens next. */
export const NEEDS_HUMAN_STATES: ReadonlySet<DealState> = new Set([
  "ESCALATED_TO_HUMAN",
  "DUPLICATE_BLOCKED",
  "ROCKETLANE_FAILED",
]);

export function canTransition(from: DealState, to: DealState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: DealState): readonly DealState[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  readonly from: DealState;
  readonly to: DealState;

  constructor(from: DealState, to: DealState) {
    super(`Illegal deal state transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: DealState, to: DealState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
