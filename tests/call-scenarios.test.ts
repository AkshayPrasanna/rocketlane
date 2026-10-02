import { describe, expect, it } from "vitest";
import { createAeDirectory } from "@/config/ae-directory";
import { IntegrationError } from "@/lib/integrations/errors";
import type { CallScript } from "@/lib/integrations/voice/mock";
import { dealEmail } from "./helpers/emails";
import { createHarness, OPS_CHANNEL } from "./helpers/harness";

const NO_ANSWER: CallScript = { kind: "terminal", outcome: "no_answer" };
const CONFIRM_ENTERPRISE: CallScript = {
  kind: "confirmed",
  tier: "enterprise",
};

/** Everything that must NOT have happened when no tier was confirmed. */
function expectNothingCreated(h: ReturnType<typeof createHarness>) {
  expect(h.rocketlane.createRequests).toHaveLength(0);
  expect(h.rocketlane.projects).toHaveLength(0);
  expect(h.slack.channels.size).toBe(0);
}

describe("AE does not answer", () => {
  it("retries up to the limit, then escalates to a human without assuming a tier", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.voice.placed).toHaveLength(3);
    expect(h.sleeps).toEqual([20, 20]);
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("ESCALATED_TO_HUMAN");
    expect(deal.planTier).toBeNull();
    expect(deal.callAttempts).toBe(3);
    expectNothingCreated(h);
  });

  it("puts the escalation in the queue and alerts the ops channel", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });

    const { messageId } = await h.run();

    const [escalation] = await h.store.deals.listEscalations({
      openOnly: true,
    });
    expect(escalation).toMatchObject({
      dealId: messageId,
      opsNotified: true,
      reason: "CALL_RETRIES_EXHAUSTED",
    });
    expect(escalation.detail).toContain("3 call attempts");
    const alert = h.slack.posts.find((p) => p.channelId === OPS_CHANNEL);
    expect(alert?.text).toContain("Onboarding needs a human");
    expect(alert?.text).toContain("Acme Corp");
    expect(alert?.text).toContain("CALL_RETRIES_EXHAUSTED");
  });

  it("gives every attempt its own audit entry", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });

    const { messageId } = await h.run();

    const entries = await h.store.audit.listByDeal(messageId);
    const placed = entries.filter((e) => e.step === "place_call");
    const evaluated = entries.filter((e) => e.step === "evaluate_call");
    expect(placed).toHaveLength(3);
    expect(evaluated.map((e) => e.outcome)).toEqual([
      "retry",
      "retry",
      "failure",
    ]);
    expect(
      evaluated.map((e) => (e.input as { attempt: number }).attempt)
    ).toEqual([1, 2, 3]);
  });

  it("proceeds normally when the AE picks up on a later attempt", async () => {
    const h = createHarness({ voice: [NO_ANSWER, CONFIRM_ENTERPRISE] });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.voice.placed).toHaveLength(2);
    expect(h.sleeps).toEqual([20]);
    expect((await h.deal(messageId)).callAttempts).toBe(2);
    expect(h.rocketlane.createRequests).toHaveLength(1);
  });

  it.each([
    ["busy", { kind: "terminal", outcome: "busy" }],
    ["failed", { kind: "terminal", outcome: "failed" }],
    ["canceled", { kind: "terminal", outcome: "canceled" }],
    ["hung up without speaking", { kind: "no_conversation" }],
  ] satisfies [
    string,
    CallScript,
  ][])("%s counts as a failed attempt", async (_name, script) => {
    const h = createHarness({ voice: [script, script, script] });

    const { outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.voice.placed).toHaveLength(3);
    expectNothingCreated(h);
  });

  it("honours a lower attempt limit from configuration", async () => {
    const h = createHarness({
      env: { MAX_CALL_ATTEMPTS: "2" },
      voice: [NO_ANSWER, NO_ANSWER],
    });

    await h.run();

    expect(h.voice.placed).toHaveLength(2);
  });
});

describe("voicemail", () => {
  it("never counts as confirmation, even if the greeting names a plan", async () => {
    const h = createHarness({
      voice: [
        { kind: "voicemail" },
        { kind: "voicemail" },
        { kind: "voicemail" },
      ],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect((await h.deal(messageId)).planTier).toBeNull();
    const entries = await h.store.audit.listByDeal(messageId);
    const evaluations = entries.filter((e) => e.step === "evaluate_call");
    expect(evaluations[0].rationale).toContain("voicemail");
    expectNothingCreated(h);
  });
});

describe("ambiguous answers", () => {
  const AMBIGUOUS: [string, CallScript][] = [
    [
      "probably Enterprise?",
      {
        aeSays: ["Hmm, probably Enterprise?"],
        extracted: { confirmed: false, planTier: "enterprise" },
        kind: "spoken",
      },
    ],
    [
      "probably Enterprise, even if the provider wrongly marks it confirmed",
      {
        aeSays: ["Probably Enterprise, I think."],
        extracted: { confirmed: true, planTier: "enterprise" },
        kind: "spoken",
      },
    ],
    [
      "Enterprise, no wait, Growth",
      {
        aeSays: ["Enterprise... no wait, Growth."],
        extracted: { confirmed: true, planTier: "growth" },
        kind: "spoken",
      },
    ],
    [
      "I'm not sure",
      {
        aeSays: ["I'm not sure, let me check."],
        extracted: { confirmed: false, planTier: "unclear" },
        kind: "spoken",
      },
    ],
    [
      "no extraction at all",
      {
        aeSays: ["It is the Enterprise plan."],
        extracted: null,
        kind: "spoken",
      },
    ],
  ];

  it.each(AMBIGUOUS)("%s is retried, then escalated", async (_name, script) => {
    const h = createHarness({ voice: [script, script, script] });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.voice.placed).toHaveLength(3);
    expect((await h.deal(messageId)).planTier).toBeNull();
    expectNothingCreated(h);
  });

  it("recovers when a later attempt is clear", async () => {
    const h = createHarness({
      voice: [
        {
          aeSays: ["Probably Growth?"],
          extracted: { confirmed: false, planTier: "growth" },
          kind: "spoken",
        },
        { kind: "confirmed", tier: "growth" },
      ],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect((await h.deal(messageId)).planTier).toBe("growth");
    expect(h.rocketlane.createRequests[0].templateId).toBe(
      "mock-template-growth"
    );
  });

  it("does not accept a tier that only our own agent said", async () => {
    const h = createHarness({
      voice: Array.from({ length: 3 }, () => ({
        aeSays: ["Yes.", "Uh huh."],
        extracted: { confirmed: true, planTier: "enterprise" as const },
        kind: "spoken" as const,
      })),
    });

    const { outcome } = await h.run();

    // The agent's question mentions both plans; the AE never said "Enterprise".
    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expectNothingCreated(h);
  });
});

describe("provider problems are not the AE's fault", () => {
  it.each([
    "balance-low",
    "error",
  ])("%s escalates immediately without burning retries", async (providerStatus) => {
    const h = createHarness({
      voice: [{ kind: "terminal", outcome: "system_error", providerStatus }],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.voice.placed).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("VOICE_SYSTEM_ERROR");
    expect(escalation.dealId).toBe(messageId);
    expect(escalation.detail).toContain(providerStatus);
    expectNothingCreated(h);
  });

  it("retries when the voice API is briefly down, then succeeds", async () => {
    const h = createHarness({
      voice: [
        {
          error: new IntegrationError(
            "voice",
            "server_error",
            "Bolna returned 503",
            {
              status: 503,
            }
          ),
          kind: "place_call_error",
        },
        CONFIRM_ENTERPRISE,
      ],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.sleeps).toEqual([20]);
    const entries = await h.store.audit.listByDeal(messageId);
    expect(
      entries.some((e) => e.step === "place_call" && e.outcome === "retry")
    ).toBe(true);
  });

  it("escalates at once on bad voice credentials instead of retrying", async () => {
    const h = createHarness({
      voice: [
        {
          error: new IntegrationError(
            "voice",
            "unauthorized",
            "Invalid API key",
            {
              status: 401,
            }
          ),
          kind: "place_call_error",
        },
      ],
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.voice.placed).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect((await h.store.deals.listEscalations())[0].reason).toBe(
      "VOICE_SYSTEM_ERROR"
    );
  });

  it("escalates after repeated dial failures", async () => {
    const down: CallScript = {
      error: new IntegrationError("voice", "server_error", "Bolna down", {
        status: 500,
      }),
      kind: "place_call_error",
    };
    const h = createHarness({ voice: [down, down, down] });

    const { outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect((await h.store.deals.listEscalations())[0].reason).toBe(
      "CALL_RETRIES_EXHAUSTED"
    );
  });
});

describe("waiting for the call result", () => {
  it("looks again when the call is still in progress", async () => {
    const h = createHarness({
      voice: [{ ...CONFIRM_ENTERPRISE, pendingPolls: 1 }],
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.voice.resultLookups).toBe(2);
  });

  it("treats a result that never arrives as a failed attempt", async () => {
    const stuck: CallScript = { ...CONFIRM_ENTERPRISE, pendingPolls: 99 };
    const h = createHarness({
      voice: [stuck, stuck, stuck],
      waitTimesOut: true,
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.detail).toContain("timeout");
    expect((await h.deal(messageId)).planTier).toBeNull();
    expectNothingCreated(h);
  });

  it("still picks up the result by polling when the webhook never arrives", async () => {
    const h = createHarness({
      voice: [CONFIRM_ENTERPRISE],
      waitTimesOut: true,
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
  });
});

describe("unknown senders", () => {
  it("are escalated before the email is read, with no reply and no call", async () => {
    const h = createHarness({ voice: [] });

    const { messageId, outcome, registered } = await h.run(
      dealEmail(),
      "stranger@evil.example"
    );

    expect(registered.status).toBe("escalated");
    expect(outcome).toBeNull();
    expect(h.parseCalls()).toBe(0);
    expect(h.gmail.replies).toHaveLength(0);
    expect(h.voice.placed).toHaveLength(0);
    expect((await h.deal(messageId)).state).toBe("ESCALATED_TO_HUMAN");
    expect((await h.store.deals.listEscalations())[0].reason).toBe(
      "UNKNOWN_AE"
    );
  });

  it("are all unknown when the directory is empty", async () => {
    const h = createHarness({ directory: createAeDirectory([]), voice: [] });

    const { registered } = await h.run();

    expect(registered.status).toBe("escalated");
    expect(h.voice.placed).toHaveLength(0);
  });

  it("match the directory case-insensitively", async () => {
    const h = createHarness({ voice: [CONFIRM_ENTERPRISE] });

    const { outcome } = await h.run(dealEmail(), "Ravi.Kumar@NovaCRM.io");

    expect(outcome).toBe("COMPLETE");
  });
});
