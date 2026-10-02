import type { CallResult } from "@/lib/integrations/voice/types";
import type { PlanTier } from "./schemas";

export type RetryReason =
  | "no_answer"
  | "busy"
  | "failed"
  | "canceled"
  | "voicemail"
  | "no_conversation"
  | "ambiguous"
  | "timeout";

export type TierDecision =
  | {
      /** The AE's own words that justify the decision, for the audit log. */
      evidence: string[];
      kind: "confirmed";
      rationale: string;
      tier: PlanTier;
    }
  | { kind: "retry"; rationale: string; reason: RetryReason }
  /** The provider failed, not the AE. Escalate without spending a retry. */
  | { kind: "system_error"; rationale: string };

const TIER_WORDS: Record<PlanTier, RegExp> = {
  enterprise: /\benterprise\b/i,
  growth: /\bgrowth\b/i,
};
const HEDGE_RE =
  /\b(probably|maybe|perhaps|possibly|i think|i guess|i believe|not sure|unsure|might be|could be|let me check|(?:don'?t|do not) (?:remember|recall|know))\b/i;
const NEGATED_TIER_RE =
  /\b(?:not|isn'?t|aren'?t|never|no longer)\b[^.?!]{0,25}\b(?:enterprise|growth)\b/i;
const TIERS = Object.keys(TIER_WORDS) as PlanTier[];

function retry(reason: RetryReason, rationale: string): TierDecision {
  return { kind: "retry", rationale, reason };
}

/**
 * The only code allowed to turn a phone call into a plan tier.
 *
 * It does not trust the voice provider's extraction on its own. A tier is accepted only if
 *  (a) the extraction says enterprise/growth AND confirmed=true,
 *  (b) the AE's own spoken turns literally contain that tier word,
 *  (c) the AE never said the other tier word, and
 *  (d) the AE did not hedge ("probably", "I think") or negate ("not Enterprise").
 * Only the AE's turns count. Our agent's questions mention both tiers by design, and
 * anything else in the call or the email is ignored. A voicemail never confirms anything.
 */
export function decideTier(result: CallResult): TierDecision {
  if (!(result.isTerminal && result.outcome)) {
    throw new Error(
      `Cannot decide a tier from a call that is still in progress (${result.providerStatus})`
    );
  }

  switch (result.outcome) {
    case "system_error":
      return {
        kind: "system_error",
        rationale: `Voice provider reported ${result.providerStatus}${result.errorMessage ? `: ${result.errorMessage}` : ""}. This is a platform problem, not an AE problem, so it is not retried.`,
      };
    case "no_answer":
    case "busy":
    case "failed":
    case "canceled":
      return retry(
        result.outcome,
        `Call ended as "${result.providerStatus}" with no confirmation from the AE.`
      );
    default:
      break;
  }

  if (result.answeredByVoicemail) {
    return retry(
      "voicemail",
      "The call was answered by voicemail. A voicemail never counts as confirmation."
    );
  }

  const aeTurns = result.turns
    .filter((turn) => turn.speaker === "callee")
    .map((turn) => turn.text);
  if (result.conversationSeconds <= 0 || aeTurns.length === 0) {
    return retry(
      "no_conversation",
      "The call was marked completed but the AE never spoke, so no conversation took place."
    );
  }

  const extracted = result.extracted;
  if (
    !(
      extracted &&
      extracted.confirmed === true &&
      (extracted.planTier === "enterprise" || extracted.planTier === "growth")
    )
  ) {
    return retry(
      "ambiguous",
      `The provider did not report a confirmed tier (planTier=${extracted?.planTier ?? "none"}, confirmed=${String(extracted?.confirmed ?? null)}).`
    );
  }

  const tier = extracted.planTier;
  const spoken = aeTurns.join(" ");
  const saidTiers = TIERS.filter((candidate) =>
    TIER_WORDS[candidate].test(spoken)
  );

  if (!saidTiers.includes(tier)) {
    return retry(
      "ambiguous",
      `The provider reported "${tier}" but the AE never said that word.`
    );
  }
  if (saidTiers.length > 1) {
    return retry(
      "ambiguous",
      "The AE mentioned both plans, so the answer contradicts itself."
    );
  }
  if (HEDGE_RE.test(spoken)) {
    return retry(
      "ambiguous",
      "The AE hedged (for example 'probably' or 'I think'), which is not a clear confirmation."
    );
  }
  if (NEGATED_TIER_RE.test(spoken)) {
    return retry(
      "ambiguous",
      "The AE negated a plan name, so the answer is unclear."
    );
  }

  return {
    evidence: aeTurns.filter((text) => TIER_WORDS[tier].test(text)),
    kind: "confirmed",
    rationale: `The AE said "${tier}" without contradiction or hedging, and the provider recorded an explicit yes.`,
    tier,
  };
}
