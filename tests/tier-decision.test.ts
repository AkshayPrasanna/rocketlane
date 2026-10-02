import { describe, expect, it } from "vitest";
import { decideTier } from "@/lib/domain/tier-decision";
import type {
  CallResult,
  ExtractedTier,
  TranscriptTurn,
} from "@/lib/integrations/voice/types";

function call(overrides: Partial<CallResult> = {}): CallResult {
  return {
    answeredByVoicemail: false,
    conversationSeconds: 30,
    errorMessage: null,
    executionId: "exec-1",
    extracted: { confirmed: true, planTier: "enterprise" },
    isTerminal: true,
    outcome: "completed",
    providerStatus: "completed",
    turns: [
      {
        speaker: "agent",
        text: "Is it the Enterprise plan or the Growth plan?",
      },
      { speaker: "callee", text: "It's the Enterprise plan." },
    ],
    ...overrides,
  };
}

function aeSays(...texts: string[]): TranscriptTurn[] {
  return [
    { speaker: "agent", text: "Is it the Enterprise plan or the Growth plan?" },
    ...texts.map((text) => ({ speaker: "callee" as const, text })),
  ];
}

describe("decideTier: accepting", () => {
  it("accepts a clear spoken answer backed by a confirmed extraction", () => {
    const decision = decideTier(call());

    expect(decision).toMatchObject({ kind: "confirmed", tier: "enterprise" });
    if (decision.kind === "confirmed") {
      expect(decision.evidence).toEqual(["It's the Enterprise plan."]);
    }
  });

  it("accepts Growth the same way", () => {
    const decision = decideTier(
      call({
        extracted: { confirmed: true, planTier: "growth" },
        turns: aeSays("Growth.", "Yes, that's right."),
      })
    );

    expect(decision).toMatchObject({ kind: "confirmed", tier: "growth" });
  });

  it("is case-insensitive about the tier word", () => {
    const decision = decideTier(call({ turns: aeSays("ENTERPRISE plan") }));

    expect(decision.kind).toBe("confirmed");
  });
});

describe("decideTier: rejecting", () => {
  const retryReason = (result: CallResult) => {
    const decision = decideTier(result);
    return decision.kind === "retry" ? decision.reason : decision.kind;
  };

  it.each([
    ["no_answer", "no_answer"],
    ["busy", "busy"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ] as const)("a %s call retries", (outcome, reason) => {
    expect(retryReason(call({ outcome, providerStatus: outcome }))).toBe(
      reason
    );
  });

  it("treats provider failures as system errors, not retries", () => {
    expect(
      retryReason(
        call({ outcome: "system_error", providerStatus: "balance-low" })
      )
    ).toBe("system_error");
  });

  it("rejects voicemail even with a perfect-looking transcript and extraction", () => {
    expect(retryReason(call({ answeredByVoicemail: true }))).toBe("voicemail");
  });

  it("rejects a 'completed' call where the AE never spoke", () => {
    expect(retryReason(call({ turns: aeSays(), conversationSeconds: 0 }))).toBe(
      "no_conversation"
    );
    expect(retryReason(call({ turns: aeSays() }))).toBe("no_conversation");
  });

  it.each<[string, ExtractedTier | null]>([
    ["no extraction", null],
    ["unclear", { confirmed: true, planTier: "unclear" }],
    ["unconfirmed", { confirmed: false, planTier: "enterprise" }],
    ["unknown confirmation", { confirmed: null, planTier: "enterprise" }],
    ["no tier", { confirmed: true, planTier: null }],
  ])("rejects when the provider reports %s", (_name, extracted) => {
    expect(retryReason(call({ extracted }))).toBe("ambiguous");
  });

  it("rejects a tier the AE never said", () => {
    expect(retryReason(call({ turns: aeSays("Yes.", "Sounds right.") }))).toBe(
      "ambiguous"
    );
  });

  it("rejects when the AE said a different tier than the provider reported", () => {
    expect(
      retryReason(
        call({
          extracted: { confirmed: true, planTier: "enterprise" },
          turns: aeSays("It's Growth."),
        })
      )
    ).toBe("ambiguous");
  });

  it("ignores tier words spoken only by our own agent", () => {
    expect(
      retryReason(
        call({
          turns: [
            { speaker: "agent", text: "I heard Enterprise. Is that correct?" },
            { speaker: "callee", text: "Yes." },
          ],
        })
      )
    ).toBe("ambiguous");
  });

  it.each([
    "Enterprise... no wait, Growth.",
    "Enterprise, not Growth.",
    "Is it Enterprise or Growth? I forget.",
  ])("rejects a self-contradiction: %s", (said) => {
    expect(retryReason(call({ turns: aeSays(said) }))).toBe("ambiguous");
  });

  it.each([
    "Probably Enterprise?",
    "I think it's Enterprise.",
    "Maybe Enterprise.",
    "Enterprise, I guess.",
    "Not sure, possibly Enterprise.",
    "I don't remember, Enterprise?",
  ])("rejects a hedge: %s", (said) => {
    expect(retryReason(call({ turns: aeSays(said) }))).toBe("ambiguous");
  });

  it.each([
    "It's not Enterprise.",
    "Definitely isn't the Enterprise plan.",
  ])("rejects a negated tier: %s", (said) => {
    expect(retryReason(call({ turns: aeSays(said) }))).toBe("ambiguous");
  });

  it("refuses to decide on a call that is still in progress", () => {
    expect(() =>
      decideTier(
        call({
          isTerminal: false,
          outcome: null,
          providerStatus: "in-progress",
        })
      )
    ).toThrow("still in progress");
  });
});
