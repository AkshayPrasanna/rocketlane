import type { AeDirectory } from "@/config/ae-directory";
import type { PlanTier } from "@/lib/domain/schemas";
import type { DealState } from "@/lib/domain/states";
import type { EmailParser } from "@/lib/intake/parser";
import type { GmailClient } from "@/lib/integrations/gmail/types";
import type { RocketlaneClient } from "@/lib/integrations/rocketlane/types";
import type { SlackClient } from "@/lib/integrations/slack/types";
import type { VoiceProvider } from "@/lib/integrations/voice/types";
import type { Store } from "@/lib/store/types";
import type { PipelineSettings } from "./settings";

/** Everything the step functions need. Every external system is injected, never imported. */
export interface PipelineDeps {
  clock: () => Date;
  directory: AeDirectory;
  gmail: GmailClient;
  newId: () => string;
  parser: EmailParser;
  rocketlane: RocketlaneClient;
  settings: PipelineSettings;
  slack: SlackClient;
  store: Store;
  voice: VoiceProvider;
}

export type RegisterResult =
  | { dealId: string; status: "registered" }
  | { dealId: string; status: "duplicate" }
  | { dealId: string; status: "escalated" }
  | { reason: string; status: "ignored" };

/*
 * Step results are small, JSON-safe objects. Expected failures (a missing field, a busy
 * line, a 500 from Rocketlane) come back as values so the orchestrator can branch on them;
 * only genuine bugs throw.
 */
export type ParseStepResult =
  | { status: "validated" }
  | { missing: string[]; status: "needs_clarification" }
  | { status: "duplicate_opportunity" }
  | { status: "escalated" };

export type PlaceCallStepResult =
  | { executionId: string; status: "dialed" }
  | { status: "retry" }
  | { status: "escalated" };

export type EvaluateCallStepResult =
  | { status: "confirmed"; tier: PlanTier }
  | { status: "pending" }
  | { status: "retry" }
  | { status: "escalated" };

export type ProjectStepResult =
  | { projectId: string; status: "created" }
  | { delaySeconds: number; status: "retry" }
  | { status: "blocked_duplicate" }
  | { status: "failed" };

export type ChannelStepResult =
  | { status: "created" }
  | { delaySeconds: number; status: "retry" }
  | { status: "failed" };

export interface Timings {
  callResultTimeoutSeconds: number;
  callRetryDelaySeconds: number;
}

export interface OnboardingSteps {
  begin(dealId: string, workflowRunId: string): Promise<void>;
  complete(dealId: string): Promise<void>;
  createChannel(dealId: string, attempt: number): Promise<ChannelStepResult>;
  createProject(dealId: string, attempt: number): Promise<ProjectStepResult>;
  escalateUnexpected(dealId: string, message: string): Promise<void>;
  evaluateCall(
    dealId: string,
    attempt: number,
    executionId: string,
    timedOut: boolean
  ): Promise<EvaluateCallStepResult>;
  getTimings(): Promise<Timings>;
  parseAndValidate(dealId: string): Promise<ParseStepResult>;
  placeCall(dealId: string, attempt: number): Promise<PlaceCallStepResult>;
}

/** Resolves when the call-result webhook arrives, or reports that the wait timed out. */
export interface CallWaiter {
  dispose(): void;
  wait(timeoutSeconds: number): Promise<{ timedOut: boolean }>;
}

/**
 * The durable primitives the host supplies. Vercel Workflow implements them with
 * `sleep()` and a hook; tests implement them instantly.
 */
export interface PipelineRuntime {
  /** Must be opened BEFORE the call is placed, or a fast webhook could be missed. */
  openCallWaiter(args: {
    attempt: number;
    dealId: string;
    hookToken: string;
  }): CallWaiter;
  sleep(seconds: number): Promise<void>;
}

export type OnboardingOutcome = Extract<
  DealState,
  | "COMPLETE"
  | "NEEDS_CLARIFICATION"
  | "DUPLICATE_BLOCKED"
  | "ROCKETLANE_FAILED"
  | "ESCALATED_TO_HUMAN"
>;
