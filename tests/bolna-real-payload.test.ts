import { describe, expect, it } from "vitest";
import { decideTier } from "@/lib/domain/tier-decision";
import { BolnaVoiceProvider } from "@/lib/integrations/voice/bolna";
import realCall from "./fixtures/bolna-real-call-enterprise.json";

/**
 * A real call: placed through Bolna to a real phone, with the AE saying "enterprise plan" and
 * confirming. Only the execution ID and the AE's name were changed. It proves the client reads
 * Bolna's actual response shape (nested extraction, padded transcript lines, null voicemail flag),
 * not just the shape the documentation describes.
 */
function readReal(overrides: Record<string, unknown> = {}) {
  const provider = new BolnaVoiceProvider({
    agentId: "123e4567-e89b-42d3-a456-426614174000",
    apiKey: "test-key-1234567890",
    fetchImpl: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...realCall, ...overrides }), {
          status: 200,
        })
      )) as typeof fetch,
  });
  return provider.getResult(realCall.id);
}

describe("a real Bolna call, read by the system", () => {
  it("is a finished, answered conversation", async () => {
    const result = await readReal();

    expect(result.isTerminal).toBe(true);
    expect(result.outcome).toBe("completed");
    expect(result.answeredByVoicemail).toBe(false);
    expect(result.conversationSeconds).toBeGreaterThan(0);
  });

  it("separates our agent from the AE", async () => {
    const result = await readReal();

    expect(
      result.turns.filter((t) => t.speaker === "callee").map((t) => t.text)
    ).toEqual(["yes", "enterprise plan", "yeah"]);
    expect(result.turns.at(-1)).toEqual({
      speaker: "agent",
      text: "Thank you, that's confirmed. Goodbye.",
    });
  });

  it("reads the nested extraction Bolna really returns", async () => {
    expect((await readReal()).extracted).toEqual({
      confirmed: true,
      planTier: "enterprise",
    });
  });

  it("is accepted by the tier decision rule as Enterprise", async () => {
    const decision = decideTier(await readReal());

    expect(decision).toMatchObject({ kind: "confirmed", tier: "enterprise" });
    if (decision.kind === "confirmed") {
      expect(decision.evidence).toEqual(["enterprise plan"]);
    }
  });

  it("is rejected if the same call had been a voicemail", async () => {
    const decision = decideTier(
      await readReal({ answered_by_voice_mail: true })
    );

    expect(decision).toMatchObject({ kind: "retry", reason: "voicemail" });
  });

  it("is rejected if the AE had hedged, even with Bolna's extraction unchanged", async () => {
    const decision = decideTier(
      await readReal({
        transcript:
          "assistant: Is this customer on the Enterprise plan or the Growth plan?\nuser:  probably enterprise\nassistant:  I heard Enterprise. Is that correct?\nuser:  yeah",
      })
    );

    expect(decision).toMatchObject({ kind: "retry", reason: "ambiguous" });
  });
});
