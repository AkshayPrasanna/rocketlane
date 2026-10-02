import { decideTier, type TierDecision } from "@/lib/domain/tier-decision";
import { IntegrationError } from "@/lib/integrations/errors";
import type { CallResult } from "@/lib/integrations/voice/types";
import { callHookToken } from "./call-hook";
import { auditorFor, describeError, escalate, requireDeal } from "./support";
import type {
  EvaluateCallStepResult,
  PipelineDeps,
  PlaceCallStepResult,
} from "./types";

const CONFIRMED_STATES: ReadonlySet<string> = new Set([
  "TIER_CONFIRMED",
  "PROJECT_CREATED",
  "CHANNEL_CREATED",
  "COMPLETE",
  "DUPLICATE_BLOCKED",
  "ROCKETLANE_FAILED",
]);

function summarizeResult(result: CallResult) {
  return {
    answeredByVoicemail: result.answeredByVoicemail,
    conversationSeconds: result.conversationSeconds,
    errorMessage: result.errorMessage,
    extracted: result.extracted,
    outcome: result.outcome,
    providerStatus: result.providerStatus,
    transcript: result.turns.map((turn) => `${turn.speaker}: ${turn.text}`),
  };
}

export async function placeCall(
  deps: PipelineDeps,
  dealId: string,
  attempt: number
): Promise<PlaceCallStepResult> {
  const deal = await requireDeal(deps, dealId);
  const auditor = auditorFor(deps, deal, "intake");
  const { maxCallAttempts } = deps.settings;
  const ae = deps.directory.lookup(deal.aeEmail);
  const customerName = deal.parsed?.customerName;

  if (!(ae && customerName)) {
    await escalate(deps, {
      agent: "intake",
      dealId,
      detail:
        "The AE is not in the directory or the customer name is missing, so no call was placed.",
      rationale: "Never dial a number that did not come from the AE directory.",
      reason: "UNKNOWN_AE",
      step: "place_call",
      toState: "ESCALATED_TO_HUMAN",
    });
    return { status: "escalated" };
  }

  if (deal.state === "VALIDATED" || deal.state === "CALL_RETRY") {
    await deps.store.deals.transitionDeal(dealId, "CALLING_AE", {
      callAttempts: attempt,
      stateReason: `Calling the AE (attempt ${attempt} of ${maxCallAttempts})`,
    });
  }

  // A retried step must never dial a second time for the same attempt.
  const firstDial = await deps.store.deals.claimCallAttempt(dealId, attempt);
  if (!firstDial) {
    const existing = await deps.store.deals.getCallAttemptExecution(
      dealId,
      attempt
    );
    if (existing) {
      return { executionId: existing, status: "dialed" };
    }
    return await failDial(deps, {
      attempt,
      dealId,
      detail: `The dial for attempt ${attempt} may or may not have gone out. Not redialling to avoid calling the AE twice.`,
      retryable: true,
    });
  }

  try {
    const { executionId } = await deps.voice.placeCall({
      aeName: ae.name,
      aePhone: ae.phone,
      attempt,
      customerName,
      dealId,
    });
    await deps.store.deals.saveCallExecution({
      attempt,
      dealId,
      executionId,
      hookToken: callHookToken(dealId, attempt),
    });
    await auditor.record({
      input: {
        aeName: ae.name,
        aePhone: ae.phone,
        attempt,
        customerName,
      },
      outcome: "success",
      output: { executionId },
      rationale:
        "Placed a real voice call to the number in the AE directory. The number never comes from the email.",
      step: "place_call",
    });
    return { executionId, status: "dialed" };
  } catch (error) {
    if (!(error instanceof IntegrationError)) {
      throw error;
    }
    return await failDial(deps, {
      attempt,
      dealId,
      detail: describeError(error),
      retryable: error.retryable,
    });
  }
}

async function failDial(
  deps: PipelineDeps,
  args: { attempt: number; dealId: string; detail: string; retryable: boolean }
): Promise<PlaceCallStepResult> {
  const { attempt, dealId, detail, retryable } = args;
  const deal = await requireDeal(deps, dealId);
  const auditor = auditorFor(deps, deal, "intake");
  const exhausted = attempt >= deps.settings.maxCallAttempts;

  await auditor.record({
    input: { attempt },
    outcome: retryable && !exhausted ? "retry" : "failure",
    output: { detail, retryable },
    rationale: retryable
      ? "The voice provider could not place the call right now."
      : "The voice provider rejected the request. Retrying the same request would not help.",
    step: "place_call",
  });

  if (retryable && !exhausted) {
    await deps.store.deals.transitionDeal(dealId, "CALL_RETRY", {
      stateReason: `Dial attempt ${attempt} failed: ${detail}`,
    });
    return { status: "retry" };
  }

  await escalate(deps, {
    agent: "intake",
    dealId,
    detail: retryable
      ? `Could not place a call after ${attempt} attempts. Last error: ${detail}`
      : `The voice provider rejected the call: ${detail}`,
    input: { attempt },
    rationale: retryable
      ? "Attempts are exhausted. A human must reach the AE; no tier is assumed."
      : "This is a provider or configuration problem, not an AE problem, so it is escalated without burning retries.",
    reason: retryable ? "CALL_RETRIES_EXHAUSTED" : "VOICE_SYSTEM_ERROR",
    step: "escalate_call",
    toState: "ESCALATED_TO_HUMAN",
  });
  return { status: "escalated" };
}

function auditOutcome(
  decision: TierDecision,
  exhausted: boolean
): "success" | "retry" | "failure" {
  if (decision.kind === "confirmed") {
    return "success";
  }
  return decision.kind === "retry" && !exhausted ? "retry" : "failure";
}

function timeoutDecision(seconds: number): TierDecision {
  return {
    kind: "retry",
    rationale: `No final result from the voice provider within ${seconds} seconds.`,
    reason: "timeout",
  };
}

export async function evaluateCall(
  deps: PipelineDeps,
  dealId: string,
  attempt: number,
  executionId: string,
  timedOut: boolean
): Promise<EvaluateCallStepResult> {
  const deal = await requireDeal(deps, dealId);

  // Already decided by an earlier run of this step (or the deal has moved well past it).
  if (deal.planTier && CONFIRMED_STATES.has(deal.state)) {
    return { status: "confirmed", tier: deal.planTier };
  }
  if (deal.state === "CALL_RETRY") {
    return { status: "retry" };
  }
  if (deal.state === "ESCALATED_TO_HUMAN") {
    return { status: "escalated" };
  }

  const auditor = auditorFor(deps, deal, "intake");
  // Pull the truth from the provider; a webhook body is only ever a nudge to look.
  const result = await deps.voice.getResult(executionId);

  if (!(result.isTerminal || timedOut)) {
    return { status: "pending" };
  }
  const decision = result.isTerminal
    ? decideTier(result)
    : timeoutDecision(deps.settings.callResultTimeoutSeconds);

  const exhausted = attempt >= deps.settings.maxCallAttempts;
  await auditor.record({
    input: { attempt, executionId },
    outcome: auditOutcome(decision, exhausted),
    output: {
      decision:
        decision.kind === "confirmed"
          ? {
              evidence: decision.evidence,
              kind: "confirmed",
              tier: decision.tier,
            }
          : decision,
      ...summarizeResult(result),
    },
    rationale: decision.rationale,
    step: "evaluate_call",
  });

  if (decision.kind === "confirmed") {
    await deps.store.deals.transitionDeal(dealId, "TIER_CONFIRMED", {
      planTier: decision.tier,
      stateReason: `AE confirmed the ${decision.tier} plan on call attempt ${attempt}`,
    });
    return { status: "confirmed", tier: decision.tier };
  }

  if (decision.kind === "system_error") {
    await escalate(deps, {
      agent: "intake",
      dealId,
      detail: decision.rationale,
      input: { attempt, executionId },
      rationale:
        "A provider or account problem, not an unreachable AE, so it is escalated immediately and does not consume a retry.",
      reason: "VOICE_SYSTEM_ERROR",
      step: "escalate_call",
      toState: "ESCALATED_TO_HUMAN",
    });
    return { status: "escalated" };
  }

  if (exhausted) {
    await escalate(deps, {
      agent: "intake",
      dealId,
      detail: `No clear plan confirmation after ${attempt} call attempts. Last outcome: ${decision.reason}.`,
      input: { attempt, executionId },
      rationale:
        "Retries are exhausted. A human must confirm the plan tier; the system never assumes one.",
      reason: "CALL_RETRIES_EXHAUSTED",
      step: "escalate_call",
      toState: "ESCALATED_TO_HUMAN",
    });
    return { status: "escalated" };
  }

  await deps.store.deals.transitionDeal(dealId, "CALL_RETRY", {
    stateReason: `Attempt ${attempt} did not confirm a tier (${decision.reason}); will retry`,
  });
  return { status: "retry" };
}
