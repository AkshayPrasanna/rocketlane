import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  DEAL_STATES,
  InvalidTransitionError,
  NEEDS_HUMAN_STATES,
  nextStates,
} from "@/lib/domain/states";

describe("deal state machine", () => {
  it("allows the happy path end to end", () => {
    const path = [
      "RECEIVED",
      "PARSED",
      "VALIDATED",
      "CALLING_AE",
      "TIER_CONFIRMED",
      "PROJECT_CREATED",
      "CHANNEL_CREATED",
      "COMPLETE",
    ] as const;

    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("never reaches project creation without a confirmed tier", () => {
    const reachesProject = DEAL_STATES.filter((from) =>
      canTransition(from, "PROJECT_CREATED")
    );

    expect(reachesProject).toEqual(["TIER_CONFIRMED"]);
  });

  it("only reaches the call from a validated or retrying deal", () => {
    const reachesCall = DEAL_STATES.filter((from) =>
      canTransition(from, "CALLING_AE")
    );

    expect(reachesCall).toEqual(["VALIDATED", "CALL_RETRY"]);
  });

  it("stops after a clarification request until the AE replies", () => {
    expect(nextStates("NEEDS_CLARIFICATION")).toEqual([
      "PARSED",
      "ESCALATED_TO_HUMAN",
    ]);
    expect(canTransition("NEEDS_CLARIFICATION", "CALLING_AE")).toBe(false);
  });

  it("treats final states as dead ends", () => {
    for (const state of [
      "COMPLETE",
      "DUPLICATE_BLOCKED",
      "ROCKETLANE_FAILED",
      "ESCALATED_TO_HUMAN",
    ] as const) {
      expect(nextStates(state)).toEqual([]);
    }
  });

  it("throws a descriptive error for an illegal move", () => {
    expect(() => assertTransition("VALIDATED", "PROJECT_CREATED")).toThrow(
      InvalidTransitionError
    );
    expect(() => assertTransition("VALIDATED", "PROJECT_CREATED")).toThrow(
      "VALIDATED -> PROJECT_CREATED"
    );
  });

  it("lets any in-flight deal be escalated, but not one that has already stopped", () => {
    const stopped = [
      "COMPLETE",
      "DUPLICATE_BLOCKED",
      "ROCKETLANE_FAILED",
      "ESCALATED_TO_HUMAN",
    ];
    for (const state of DEAL_STATES) {
      expect(canTransition(state, "ESCALATED_TO_HUMAN")).toBe(
        !stopped.includes(state)
      );
    }
  });

  it("blocks a duplicate opportunity before anyone is called", () => {
    expect(canTransition("PARSED", "DUPLICATE_BLOCKED")).toBe(true);
    expect(canTransition("PARSED", "CALLING_AE")).toBe(false);
  });

  it("flags the states a human must act on", () => {
    expect([...NEEDS_HUMAN_STATES].sort()).toEqual([
      "DUPLICATE_BLOCKED",
      "ESCALATED_TO_HUMAN",
      "ROCKETLANE_FAILED",
    ]);
  });
});
