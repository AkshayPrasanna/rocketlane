import { describe, expect, it } from "vitest";
import {
  ackOutbox,
  ackPayloadSchema,
  handleIngest,
  ingestPayloadSchema,
  listOutbox,
  MAX_INGEST_BATCH,
} from "@/lib/gmail-bridge/handlers";
import { IntegrationError } from "@/lib/integrations/errors";
import { BridgeGmailClient } from "@/lib/integrations/gmail/bridge";
import { createBridgeHarness } from "./helpers/bridge";
import { dealEmail } from "./helpers/emails";

describe("ingesting emails from the Apps Script", () => {
  it("registers a new deal email and starts its workflow", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results).toEqual([{ id: message.id, status: "registered" }]);
    expect(h.started).toEqual([message.id]);
    const deal = await h.deal(message.id);
    expect(deal.state).toBe("RECEIVED");
    expect(deal.workflowRunId).toBe("run-1");
    expect(deal.aeEmail).toBe(message.from.email);
  });

  it("stores the email so the workflow can read it later", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();

    await handleIngest(h.deps, [message], h.start);

    expect(await h.deps.gmail.getMessage(message.id)).toEqual(message);
  });

  it("starts one workflow per email in a batch", async () => {
    const h = createBridgeHarness();
    const batch = [h.inbound(), h.inbound(), h.inbound()];

    const results = await handleIngest(h.deps, batch, h.start);

    expect(results.map((r) => r.status)).toEqual([
      "registered",
      "registered",
      "registered",
    ]);
    expect(h.started).toHaveLength(3);
  });
});

describe("the script retrying or overlapping", () => {
  it("never starts a second workflow when the same email arrives again", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();

    await handleIngest(h.deps, [message], h.start);
    const again = await handleIngest(h.deps, [message], h.start);
    const andAgain = await handleIngest(h.deps, [message], h.start);

    expect(again[0].status).toBe("duplicate");
    expect(andAgain[0].status).toBe("duplicate");
    expect(h.started).toHaveLength(1);
    expect(await h.store.deals.listDeals()).toHaveLength(1);
  });

  it("starts exactly one workflow when two requests race", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();

    await Promise.all([
      handleIngest(h.deps, [message], h.start),
      handleIngest(h.deps, [message], h.start),
      handleIngest(h.deps, [message], h.start),
    ]);

    expect(h.started).toHaveLength(1);
    expect(await h.store.deals.listDeals()).toHaveLength(1);
  });

  it("retries the workflow start if the first attempt failed", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();
    let calls = 0;
    const flakyStart = (dealId: string) => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("workflow service unavailable"))
        : h.start(dealId);
    };

    const first = await handleIngest(h.deps, [message], flakyStart);
    const second = await handleIngest(h.deps, [message], flakyStart);

    expect(first[0]).toMatchObject({ id: message.id, status: "error" });
    expect(first[0].error).toContain("workflow service unavailable");
    expect(second[0].status).toBe("duplicate");
    expect(h.started).toEqual([message.id]);
    expect((await h.deal(message.id)).workflowRunId).toBe("run-1");
  });

  it("finishes the job if an earlier attempt claimed the email but crashed before creating the deal", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();
    await h.store.deals.claimMessage(message.id, message.id);

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results[0].status).toBe("registered");
    expect(h.started).toEqual([message.id]);
  });

  it("does not restart a deal that is already past RECEIVED", async () => {
    const h = createBridgeHarness({
      voice: [{ kind: "terminal", outcome: "no_answer" }],
    });
    const message = h.inbound();
    await handleIngest(h.deps, [message], h.start);
    await h.steps.parseAndValidate(message.id);

    await handleIngest(h.deps, [message], h.start);

    expect(h.started).toHaveLength(1);
  });
});

describe("emails that must not start onboarding", () => {
  it("ignores mail the agent sent itself", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({ generatedByAgent: true });

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results[0].status).toBe("ignored");
    expect(h.started).toEqual([]);
    expect(await h.store.deals.listDeals()).toEqual([]);
  });

  it("escalates an unknown sender without starting a workflow", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({
      from: { email: "stranger@evil.example", name: "Eve" },
    });

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results[0].status).toBe("escalated");
    expect(h.started).toEqual([]);
    expect((await h.store.deals.listEscalations())[0].reason).toBe(
      "UNKNOWN_AE"
    );
  });

  it("escalates a known AE address that fails email authentication (spoofing)", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({ senderAuthentication: "fail" });

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results[0].status).toBe("escalated");
    expect(h.started).toEqual([]);
    expect(h.parseCalls()).toBe(0);
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("SENDER_NOT_AUTHENTICATED");
    expect(escalation.detail).toContain("forged");
  });

  it("accepts a known AE when Gmail gave no authentication result, and says so in the log", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({ senderAuthentication: "unknown" });

    const results = await handleIngest(h.deps, [message], h.start);

    expect(results[0].status).toBe("registered");
    const entries = await h.store.audit.listByDeal(message.id);
    const verify = entries.find((e) => e.step === "verify_sender");
    expect(verify?.rationale).toContain("no authentication result");
  });

  it("records a verified sender in the audit log", async () => {
    const h = createBridgeHarness();
    const message = h.inbound();

    await handleIngest(h.deps, [message], h.start);

    const entries = await h.store.audit.listByDeal(message.id);
    expect(
      entries.find((e) => e.step === "verify_sender")?.rationale
    ).toContain("passed Gmail's email authentication");
  });

  it("reports a bad message as an error without blocking the rest of the batch", async () => {
    const h = createBridgeHarness();
    const good = h.inbound();
    const failing = h.inbound();
    const flaky = (dealId: string) =>
      dealId === failing.id
        ? Promise.reject(new Error("boom"))
        : h.start(dealId);

    const results = await handleIngest(h.deps, [failing, good], flaky);

    expect(results.map((r) => r.status)).toEqual(["error", "registered"]);
  });
});

describe("replies queued for the script to send", () => {
  it("queues the clarification email in the AE's thread for the script to send", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({ email: dealEmail({ contactEmail: null }) });
    await handleIngest(h.deps, [message], h.start);

    await h.steps.parseAndValidate(message.id);

    const [reply] = await listOutbox(h.deps);
    expect(reply).toMatchObject({
      inReplyTo: message.rfc822MessageId,
      messageId: message.id,
      threadId: message.threadId,
      to: message.from.email,
    });
    expect(reply.bodyText).toContain("Customer contact email is missing");
    expect(reply.subject.startsWith("Re: ")).toBe(true);
  });

  it("stops offering a reply once the script has acknowledged it", async () => {
    const h = createBridgeHarness();
    const message = h.inbound({ email: dealEmail({ customer: null }) });
    await handleIngest(h.deps, [message], h.start);
    await h.steps.parseAndValidate(message.id);
    const [reply] = await listOutbox(h.deps);

    await ackOutbox(h.deps, [reply.id]);

    expect(await listOutbox(h.deps)).toEqual([]);
  });

  it("lets the script acknowledge the same reply twice", async () => {
    const h = createBridgeHarness();

    await expect(ackOutbox(h.deps, ["nothing-here"])).resolves.toBeUndefined();
  });
});

describe("BridgeGmailClient", () => {
  it("reports an email the script never delivered as not found", async () => {
    const h = createBridgeHarness();
    const client = new BridgeGmailClient(h.store.mail, {
      clock: h.deps.clock,
      newId: h.deps.newId,
    });

    await expect(client.getMessage("ghost")).rejects.toBeInstanceOf(
      IntegrationError
    );
  });

  it("treats labelling as the script's job", async () => {
    const h = createBridgeHarness();

    await expect(
      h.deps.gmail.addLabel("any", "processed")
    ).resolves.toBeUndefined();
  });
});

describe("request payloads", () => {
  const valid = createBridgeHarness().inbound();

  it("accepts what the script sends", () => {
    expect(ingestPayloadSchema.safeParse({ messages: [valid] }).success).toBe(
      true
    );
  });

  it.each([
    ["no messages", { messages: [] }],
    ["a missing sender", { messages: [{ ...valid, from: undefined }] }],
    [
      "an unknown authentication value",
      { messages: [{ ...valid, senderAuthentication: "maybe" }] },
    ],
    ["a non-ISO date", { messages: [{ ...valid, receivedAt: "yesterday" }] }],
    ["not an object", "hello"],
    [
      "too many messages",
      { messages: Array.from({ length: MAX_INGEST_BATCH + 1 }, () => valid) },
    ],
  ])("rejects %s", (_name, payload) => {
    expect(ingestPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("validates acknowledgements", () => {
    expect(ackPayloadSchema.safeParse({ ids: ["a"] }).success).toBe(true);
    expect(ackPayloadSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(ackPayloadSchema.safeParse({ ids: [""] }).success).toBe(false);
  });
});
