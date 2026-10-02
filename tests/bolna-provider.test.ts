import { describe, expect, it } from "vitest";
import { decideTier } from "@/lib/domain/tier-decision";
import { parseEnv } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { createIntegrations } from "@/lib/integrations/factory";
import {
  BolnaVoiceProvider,
  mapStatus,
  parseTranscript,
  readExtraction,
} from "@/lib/integrations/voice/bolna";
import { createMemoryStore } from "@/lib/store/get-store";

const API_KEY = "bolna-secret-key-1234567890";
const AGENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const INPUT = {
  aeName: "Ravi Kumar",
  aePhone: "+15555550100",
  attempt: 1,
  customerName: "Acme Corp",
  dealId: "msg-1",
};

interface Reply {
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: string;
  status?: number;
  throws?: Error;
}

/** A fake fetch that serves replies in order and records every request. */
function fakeFetch(...replies: Reply[]) {
  const calls: Array<{
    body: unknown;
    headers: Record<string, string>;
    method: string;
    url: string;
  }> = [];
  let index = 0;
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
      method: String(init.method),
      url,
    });
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (reply.throws) {
      return Promise.reject(reply.throws);
    }
    return Promise.resolve(
      new Response(reply.rawBody ?? JSON.stringify(reply.body ?? {}), {
        headers: reply.headers,
        status: reply.status ?? 200,
      })
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function provider(fetchImpl: typeof fetch, sleeps: number[] = []) {
  return new BolnaVoiceProvider({
    agentId: AGENT_ID,
    apiKey: API_KEY,
    fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
}

const EXTRACTION = (tier: string | null, confirmed: string | null) => ({
  "Call Quality": {
    "Call Outcome": { objective: "interested", subjective: "" },
  },
  "Plan confirmation": {
    confirmed: {
      confidence: 0.9,
      objective: confirmed,
      subjective: "",
      validation: null,
    },
    plan_tier: {
      confidence: 0.95,
      objective: tier,
      subjective: "",
      validation: null,
    },
  },
});

function execution(overrides: Record<string, unknown> = {}) {
  return {
    answered_by_voice_mail: false,
    conversation_duration: 42,
    error_message: null,
    extracted_data: EXTRACTION("enterprise", "yes"),
    id: "exec-1",
    status: "completed",
    total_cost: 3.2,
    transcript:
      "assistant: Hello, this is NovaCRM's onboarding assistant. Am I speaking with Ravi Kumar?\nuser: Yes, speaking.\nassistant: Is Acme Corp on the Enterprise plan or the Growth plan?\nuser: It's the Enterprise plan.\nassistant: I heard Enterprise. Is that correct?\nuser: Yes, that's correct.",
    ...overrides,
  };
}

describe("placing a call", () => {
  it("sends the agent, the AE's directory number and the names the prompt needs", async () => {
    const { calls, fetchImpl } = fakeFetch({
      body: { execution_id: "exec-9", message: "done", status: "queued" },
    });

    const result = await provider(fetchImpl).placeCall(INPUT);

    expect(result).toEqual({ executionId: "exec-9" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.bolna.ai/call");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].body).toEqual({
      agent_id: AGENT_ID,
      recipient_phone_number: "+15555550100",
      user_data: { ae_name: "Ravi Kumar", customer_name: "Acme Corp" },
    });
  });

  it("leaves from_phone_number out so Bolna uses its default number", async () => {
    const { calls, fetchImpl } = fakeFetch({
      body: { execution_id: "exec-9", status: "queued" },
    });

    await provider(fetchImpl).placeCall(INPUT);

    expect(calls[0].body).not.toHaveProperty("from_phone_number");
  });

  it.each([
    [401, "unauthorized", false],
    [403, "unauthorized", false],
    [400, "bad_request", false],
    [422, "bad_request", false],
    [429, "rate_limited", true],
    [500, "server_error", true],
    [503, "server_error", true],
  ])("maps HTTP %i to %s (retryable: %s)", async (status, kind, retryable) => {
    const { fetchImpl } = fakeFetch({ rawBody: "nope", status });

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    expect(error.status).toBe(status);
  });

  it("never puts the API key in an error message", async () => {
    const { fetchImpl } = fakeFetch({ rawBody: "bad key", status: 401 });

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error.message).not.toContain(API_KEY);
  });

  it("passes on how long Bolna asked us to wait when rate limited", async () => {
    const { fetchImpl } = fakeFetch({
      headers: { "retry-after": "30" },
      status: 429,
    });

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error.retryAfterMs).toBe(30_000);
  });

  it("reports an unreachable Bolna as a retryable network error", async () => {
    const { fetchImpl } = fakeFetch({ throws: new TypeError("fetch failed") });

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("reports a request that times out as a retryable timeout", async () => {
    const timeout = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError"
    );
    const { fetchImpl } = fakeFetch({ throws: timeout });

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error.kind).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it.each([
    [
      "a body without an execution ID",
      { body: { message: "done", status: "queued" } },
    ],
    ["a body that is not JSON", { rawBody: "<html>oops</html>" }],
    ["an empty execution ID", { body: { execution_id: "", status: "queued" } }],
  ])("refuses %s and does not pretend a call started", async (_name, reply) => {
    const { fetchImpl } = fakeFetch(reply);

    const error = await provider(fetchImpl)
      .placeCall(INPUT)
      .catch((e) => e);

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.retryable).toBe(false);
  });
});

describe("status mapping", () => {
  it.each([
    ["completed", "completed"],
    ["no-answer", "no_answer"],
    ["busy", "busy"],
    ["failed", "failed"],
    ["canceled", "canceled"],
    ["stopped", "canceled"],
    ["error", "system_error"],
    ["balance-low", "system_error"],
    ["COMPLETED", "completed"],
  ])("%s is final and means %s", (status, outcome) => {
    expect(mapStatus(status)).toBe(outcome);
  });

  it.each([
    "queued",
    "ringing",
    "in-progress",
    "initiated",
    "scheduled",
    "rescheduled",
    "call-disconnected",
    "something-new",
  ])("%s is not final", (status) => {
    expect(mapStatus(status)).toBeNull();
  });
});

describe("transcript parsing", () => {
  it("labels the person we called as the callee and our agent as the agent", () => {
    expect(parseTranscript("assistant: Hi\nuser: Hello")).toEqual([
      { speaker: "agent", text: "Hi" },
      { speaker: "callee", text: "Hello" },
    ]);
  });

  it("joins a turn that spans several lines", () => {
    expect(
      parseTranscript("user: It is\nthe Growth plan\nassistant: Thanks")
    ).toEqual([
      { speaker: "callee", text: "It is the Growth plan" },
      { speaker: "agent", text: "Thanks" },
    ]);
  });

  it("is case-insensitive about speaker labels", () => {
    expect(parseTranscript("USER: hi")[0].speaker).toBe("callee");
  });

  it.each([
    null,
    undefined,
    "",
    "   \n  ",
  ])("treats %j as no conversation", (raw) => {
    expect(parseTranscript(raw)).toEqual([]);
  });

  it("drops empty turns", () => {
    expect(parseTranscript("user:\nassistant: Hello")).toEqual([
      { speaker: "agent", text: "Hello" },
    ]);
  });
});

describe("reading the extraction", () => {
  it("finds both values under their category", () => {
    expect(readExtraction(EXTRACTION("growth", "yes"))).toEqual({
      confirmed: true,
      planTier: "growth",
    });
  });

  it.each([
    ["yes", true],
    ["Yes", true],
    ["true", true],
    ["no", false],
    ["false", false],
    ["maybe", null],
    [null, null],
  ])("reads confirmed %j as %j", (value, expected) => {
    expect(readExtraction(EXTRACTION("growth", value))?.confirmed).toBe(
      expected
    );
  });

  it.each([
    ["enterprise", "enterprise"],
    ["Enterprise", "enterprise"],
    ["growth", "growth"],
    ["unclear", "unclear"],
    ["premium", null],
    [null, null],
  ])("reads plan_tier %j as %j", (value, expected) => {
    expect(readExtraction(EXTRACTION(value, "yes"))?.planTier).toBe(expected);
  });

  it("falls back to the free-text answer when no pre-defined one was chosen", () => {
    const data = {
      "Plan confirmation": {
        plan_tier: { objective: null, subjective: "Enterprise" },
      },
    };

    expect(readExtraction(data)?.planTier).toBe("enterprise");
  });

  it.each([
    null,
    undefined,
    {},
    [],
    "x",
    { Other: { "Call Outcome": { objective: "interested" } } },
  ])("returns null when there is no plan extraction: %j", (data) => {
    expect(readExtraction(data)).toBeNull();
  });
});

describe("reading a call result", () => {
  it("fetches the execution by ID and normalises it", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: execution() });

    const result = await provider(fetchImpl).getResult("exec-1");

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://api.bolna.ai/executions/exec-1");
    expect(result).toMatchObject({
      answeredByVoicemail: false,
      conversationSeconds: 42,
      executionId: "exec-1",
      extracted: { confirmed: true, planTier: "enterprise" },
      isTerminal: true,
      outcome: "completed",
      providerStatus: "completed",
    });
    expect(result.turns.filter((t) => t.speaker === "callee")).toHaveLength(3);
  });

  it("encodes the execution ID in the URL", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: execution() });

    await provider(fetchImpl).getResult("a/b c");

    expect(calls[0].url).toBe("https://api.bolna.ai/executions/a%2Fb%20c");
  });

  it("reports a call still in progress as not final", async () => {
    const { fetchImpl } = fakeFetch({
      body: execution({
        extracted_data: {},
        status: "in-progress",
        transcript: "",
      }),
    });

    const result = await provider(fetchImpl).getResult("exec-1");

    expect(result.isTerminal).toBe(false);
    expect(result.outcome).toBeNull();
  });

  it("treats call-disconnected as not final, since the transcript is still empty", async () => {
    const { fetchImpl } = fakeFetch({
      body: execution({ extracted_data: {}, status: "call-disconnected" }),
    });

    expect((await provider(fetchImpl).getResult("exec-1")).isTerminal).toBe(
      false
    );
  });

  it("carries the voicemail flag and an error message through", async () => {
    const { fetchImpl } = fakeFetch({
      body: execution({
        answered_by_voice_mail: true,
        error_message: null,
        extracted_data: {},
      }),
    });

    expect(
      (await provider(fetchImpl).getResult("exec-1")).answeredByVoicemail
    ).toBe(true);
  });

  it("defaults the duration to zero when Bolna sends none", async () => {
    const { fetchImpl } = fakeFetch({
      body: execution({
        conversation_duration: null,
        extracted_data: {},
        status: "no-answer",
        transcript: null,
      }),
    });

    const result = await provider(fetchImpl).getResult("exec-1");

    expect(result.conversationSeconds).toBe(0);
    expect(result.outcome).toBe("no_answer");
  });

  it("looks again when the call happened but the extraction has not landed yet", async () => {
    const sleeps: number[] = [];
    const { calls, fetchImpl } = fakeFetch(
      { body: execution({ extracted_data: {} }) },
      { body: execution() }
    );

    const result = await provider(fetchImpl, sleeps).getResult("exec-1");

    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(result.extracted).toEqual({
      confirmed: true,
      planTier: "enterprise",
    });
  });

  it("gives up after a couple of looks and reports no extraction", async () => {
    const { calls, fetchImpl } = fakeFetch({
      body: execution({ extracted_data: {} }),
    });

    const result = await provider(fetchImpl).getResult("exec-1");

    expect(calls).toHaveLength(3);
    expect(result.extracted).toBeNull();
  });

  it.each([
    ["voicemail", { answered_by_voice_mail: true, extracted_data: {} }],
    [
      "a call nobody answered",
      { extracted_data: {}, status: "no-answer", transcript: "" },
    ],
    [
      "a call where the AE never spoke",
      { extracted_data: {}, transcript: "assistant: Hello?" },
    ],
    [
      "a provider error",
      { extracted_data: {}, status: "balance-low", transcript: "" },
    ],
  ])("does not wait for an extraction after %s", async (_name, overrides) => {
    const { calls, fetchImpl } = fakeFetch({ body: execution(overrides) });

    await provider(fetchImpl).getResult("exec-1");

    expect(calls).toHaveLength(1);
  });

  it("refuses a response that is missing the execution's identity", async () => {
    const { fetchImpl } = fakeFetch({ body: { status: "completed" } });

    const error = await provider(fetchImpl)
      .getResult("exec-1")
      .catch((e) => e);

    expect(error).toBeInstanceOf(IntegrationError);
  });

  it("reports an unknown execution as not found", async () => {
    const { fetchImpl } = fakeFetch({ rawBody: "not found", status: 404 });

    const error = await provider(fetchImpl)
      .getResult("ghost")
      .catch((e) => e);

    expect(error.kind).toBe("not_found");
  });
});

describe("Bolna results through the real tier decision", () => {
  async function decide(overrides: Record<string, unknown>) {
    const { fetchImpl } = fakeFetch({ body: execution(overrides) });
    return decideTier(await provider(fetchImpl).getResult("exec-1"));
  }

  it("confirms a clear Enterprise answer", async () => {
    expect(await decide({})).toMatchObject({
      kind: "confirmed",
      tier: "enterprise",
    });
  });

  it("confirms a clear Growth answer", async () => {
    const decision = await decide({
      extracted_data: EXTRACTION("growth", "yes"),
      transcript:
        "assistant: Which plan?\nuser: Growth.\nassistant: I heard Growth. Is that correct?\nuser: Yes.",
    });

    expect(decision).toMatchObject({ kind: "confirmed", tier: "growth" });
  });

  it("rejects a hedged answer even if the extraction says confirmed", async () => {
    const decision = await decide({
      transcript:
        "assistant: Which plan?\nuser: Probably Enterprise?\nassistant: I heard Enterprise. Is that correct?\nuser: Yes I think so.",
    });

    expect(decision).toMatchObject({ kind: "retry", reason: "ambiguous" });
  });

  it("rejects a self-contradiction", async () => {
    const decision = await decide({
      extracted_data: EXTRACTION("growth", "yes"),
      transcript:
        "assistant: Which plan?\nuser: Enterprise... no wait, Growth.\nassistant: I heard Growth. Is that correct?\nuser: Yes.",
    });

    expect(decision).toMatchObject({ kind: "retry", reason: "ambiguous" });
  });

  it("never accepts a voicemail", async () => {
    const decision = await decide({
      answered_by_voice_mail: true,
      transcript:
        "assistant: Hello?\nuser: You have reached the Enterprise desk. Leave a message.",
    });

    expect(decision).toMatchObject({ kind: "retry", reason: "voicemail" });
  });

  it("treats a missing extraction as not confirmed", async () => {
    expect(await decide({ extracted_data: {} })).toMatchObject({
      kind: "retry",
      reason: "ambiguous",
    });
  });

  it("treats no-answer as a failed attempt", async () => {
    const decision = await decide({
      extracted_data: {},
      status: "no-answer",
      transcript: "",
    });

    expect(decision).toMatchObject({ kind: "retry", reason: "no_answer" });
  });

  it("treats balance-low as a platform problem, not an AE problem", async () => {
    const decision = await decide({
      extracted_data: {},
      status: "balance-low",
      transcript: "",
    });

    expect(decision.kind).toBe("system_error");
  });
});

describe("live voice wiring", () => {
  it("parses the Bolna credentials from the environment", () => {
    const env = parseEnv({ BOLNA_AGENT_ID: AGENT_ID, BOLNA_API_KEY: API_KEY });

    expect(env.bolna).toEqual({ agentId: AGENT_ID, apiKey: API_KEY });
  });

  it("rejects an agent ID that is not a UUID", () => {
    expect(() => parseEnv({ BOLNA_AGENT_ID: "not-a-uuid" })).toThrow(
      "BOLNA_AGENT_ID"
    );
  });

  it("refuses to start live voice without credentials", () => {
    const env = parseEnv({ VOICE_MODE: "live" });

    expect(() =>
      createIntegrations(env, createMemoryStore(), {
        clock: () => new Date(),
        newId: () => "x",
      })
    ).toThrow("requires BOLNA_API_KEY and BOLNA_AGENT_ID");
  });

  it("builds the live provider when credentials are present", () => {
    const env = parseEnv({
      BOLNA_AGENT_ID: AGENT_ID,
      BOLNA_API_KEY: API_KEY,
      VOICE_MODE: "live",
    });

    const { voice } = createIntegrations(env, createMemoryStore(), {
      clock: () => new Date(),
      newId: () => "x",
    });

    expect(voice).toBeInstanceOf(BolnaVoiceProvider);
  });
});
