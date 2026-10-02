import { beforeEach, describe, expect, it } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import type { CallScript } from "@/lib/integrations/voice/mock";
import {
  BOLNA_WEBHOOK_IPS,
  handleVoiceWebhook,
  type ResumeHook,
  type ResumeResult,
  type VoiceWebhookConfig,
  type VoiceWebhookRequest,
} from "@/lib/voice/webhook";
import { createHarness, type Harness } from "./helpers/harness";

const SECRET = "0123456789abcdef0123456789abcdef";
const CONFIG: VoiceWebhookConfig = { ipCheck: "enforce", secret: SECRET };
const GOOD_IP = BOLNA_WEBHOOK_IPS[0];

let h: Harness;
let resumes: Array<{ payload: { executionId: string }; token: string }>;
let resumeResult: ResumeResult;
let dealId: string;
let executionId: string;

const resume: ResumeHook = (token, payload) => {
  resumes.push({ payload, token });
  return Promise.resolve(resumeResult);
};

function request(
  overrides: Partial<VoiceWebhookRequest> = {}
): VoiceWebhookRequest {
  return {
    body: { id: executionId, status: "completed" },
    clientIp: GOOD_IP,
    token: SECRET,
    ...overrides,
  };
}

/** Registers a deal and dials, so Bolna has an execution to report on. */
async function dialOne(script: CallScript[]) {
  h = createHarness({ voice: script });
  const received = await h.receive();
  dealId = received.messageId;
  await h.steps.parseAndValidate(dealId);
  const dial = await h.steps.placeCall(dealId, 1);
  if (dial.status !== "dialed") {
    throw new Error("expected a dial");
  }
  executionId = dial.executionId;
}

beforeEach(async () => {
  resumes = [];
  resumeResult = "resumed";
  await dialOne([{ kind: "confirmed", tier: "enterprise" }]);
});

describe("webhook authenticity", () => {
  it("refuses every request when no secret is configured", async () => {
    const result = await handleVoiceWebhook(
      h.deps,
      request(),
      { ...CONFIG, secret: undefined },
      resume
    );

    expect(result.status).toBe(503);
    expect(resumes).toEqual([]);
  });

  it.each([
    null,
    "",
    "wrong",
  ])("rejects the token %j with 401", async (token) => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ token }),
      CONFIG,
      resume
    );

    expect(result.status).toBe(401);
    expect(resumes).toEqual([]);
  });

  it.each([
    null,
    "203.0.113.9",
    "13.203.39.1",
  ])("rejects the source address %j with 403", async (clientIp) => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ clientIp }),
      CONFIG,
      resume
    );

    expect(result.status).toBe(403);
    expect(resumes).toEqual([]);
  });

  it("accepts each published Bolna address", async () => {
    for (const ip of BOLNA_WEBHOOK_IPS) {
      const result = await handleVoiceWebhook(
        h.deps,
        request({ clientIp: ip }),
        CONFIG,
        resume
      );

      expect([200, 502]).toContain(result.status);
      expect(result.status).not.toBe(403);
    }
  });

  it("skips the address check when it is switched off", async () => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ clientIp: "203.0.113.9" }),
      { ...CONFIG, ipCheck: "off" },
      resume
    );

    expect(result.status).toBe(200);
    expect(resumes).toHaveLength(1);
  });

  it("checks the secret before anything else", async () => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ body: "not json", clientIp: "203.0.113.9", token: "wrong" }),
      CONFIG,
      resume
    );

    expect(result.status).toBe(401);
  });

  it.each([
    null,
    "text",
    {},
    { id: "x" },
    { status: "completed" },
    { id: "", status: "completed" },
  ])("rejects the invalid payload %j with 400", async (body) => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ body }),
      CONFIG,
      resume
    );

    expect(result.status).toBe(400);
  });
});

describe("webhook behaviour", () => {
  it("wakes the workflow's hook for a finished call", async () => {
    const result = await handleVoiceWebhook(h.deps, request(), CONFIG, resume);

    expect(result).toEqual({ body: { action: "resumed" }, status: 200 });
    expect(resumes).toEqual([
      { payload: { executionId }, token: `call:${dealId}:1` },
    ]);
  });

  it.each([
    "queued",
    "ringing",
    "in-progress",
    "call-disconnected",
    "scheduled",
    "initiated",
  ])("ignores the non-final status %s", async (status) => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ body: { id: executionId, status } }),
      CONFIG,
      resume
    );

    expect(result.status).toBe(200);
    expect(result.body.action).toBe("ignored");
    expect(resumes).toEqual([]);
  });

  it.each([
    "completed",
    "no-answer",
    "busy",
    "failed",
    "canceled",
    "stopped",
    "error",
    "balance-low",
  ])("treats %s as final", async (status) => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ body: { id: executionId, status } }),
      CONFIG,
      resume
    );

    expect(result.body.action).toBe("resumed");
  });

  it("wakes the workflow only once however many times Bolna repeats itself", async () => {
    const results: Awaited<ReturnType<typeof handleVoiceWebhook>>[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(await handleVoiceWebhook(h.deps, request(), CONFIG, resume));
    }

    expect(results.map((r) => r.body.action)).toEqual([
      "resumed",
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(resumes).toHaveLength(1);
  });

  it("waits for the final event after call-disconnected arrives first", async () => {
    await handleVoiceWebhook(
      h.deps,
      request({ body: { id: executionId, status: "call-disconnected" } }),
      CONFIG,
      resume
    );
    expect(resumes).toEqual([]);

    await handleVoiceWebhook(
      h.deps,
      request({ body: { id: executionId, status: "completed" } }),
      CONFIG,
      resume
    );

    expect(resumes).toHaveLength(1);
  });

  it("acknowledges an execution it has never heard of without waking anything", async () => {
    const result = await handleVoiceWebhook(
      h.deps,
      request({ body: { id: "exec-unknown", status: "completed" } }),
      CONFIG,
      resume
    );

    expect(result).toEqual({
      body: { action: "ignored", reason: "unknown execution" },
      status: 200,
    });
    expect(resumes).toEqual([]);
  });

  it("does not trust the body: the provider must confirm the call is over", async () => {
    await dialOne([{ kind: "confirmed", tier: "enterprise", pendingPolls: 1 }]);

    const early = await handleVoiceWebhook(h.deps, request(), CONFIG, resume);
    expect(early.body.action).toBe("ignored");
    expect(resumes).toEqual([]);

    const later = await handleVoiceWebhook(h.deps, request(), CONFIG, resume);
    expect(later.body.action).toBe("resumed");
    expect(resumes).toHaveLength(1);
  });

  it("answers 200 when no workflow is waiting, since the workflow will pull the result itself", async () => {
    resumeResult = "not_waiting";

    const result = await handleVoiceWebhook(h.deps, request(), CONFIG, resume);

    expect(result).toEqual({ body: { action: "not_waiting" }, status: 200 });
  });

  it("reports a provider outage as 502 so the sender may retry", async () => {
    h.deps.voice = {
      getResult: () =>
        Promise.reject(
          new IntegrationError("voice", "server_error", "down", { status: 503 })
        ),
      placeCall: () => Promise.reject(new Error("unused")),
    };

    const result = await handleVoiceWebhook(h.deps, request(), CONFIG, resume);

    expect(result.status).toBe(502);
    expect(resumes).toEqual([]);
  });

  it("records the webhook in the deal's audit log", async () => {
    await handleVoiceWebhook(h.deps, request(), CONFIG, resume);

    const entries = await h.store.audit.listByDeal(dealId);
    const entry = entries.find((e) => e.step === "voice_webhook");
    expect(entry?.rationale).toContain("verified directly with the provider");
    expect(entry?.output).toMatchObject({
      providerStatus: "completed",
      resumed: true,
    });
  });
});
