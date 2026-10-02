import { describe, expect, it } from "vitest";
import { runOnboarding } from "@/lib/pipeline/orchestrator";
import { registerMessage } from "@/lib/pipeline/register";
import { dealEmail } from "./helpers/emails";
import { createHarness, WORKFLOW_RUN_ID } from "./helpers/harness";

const ENTERPRISE = [{ kind: "confirmed", tier: "enterprise" }] as const;

describe("duplicate email delivery", () => {
  it("creates one deal no matter how often the same message is delivered", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId, registered } = await h.receive();
    expect(registered.status).toBe("registered");

    const again = await registerMessage(h.deps, messageId);
    const andAgain = await registerMessage(h.deps, messageId);

    expect(again).toEqual({ dealId: messageId, status: "duplicate" });
    expect(andAgain).toEqual({ dealId: messageId, status: "duplicate" });
    expect(await h.store.deals.listDeals()).toHaveLength(1);
  });

  it("never starts a second call, project or channel", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId, outcome } = await h.run();
    expect(outcome).toBe("COMPLETE");

    // Pub/Sub redelivers, and the poll fallback fires too.
    const redelivered = await registerMessage(h.deps, messageId);
    expect(redelivered.status).toBe("duplicate");

    expect(h.voice.placed).toHaveLength(1);
    expect(h.rocketlane.projects).toHaveLength(1);
    expect(h.slack.channels.size).toBe(1);
  });

  it("records the skipped delivery in the audit log under the original run", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId } = await h.receive();
    const deal = await h.deal(messageId);

    await registerMessage(h.deps, messageId);

    const entries = await h.store.audit.listByDeal(messageId);
    const skipped = entries.filter((e) => e.outcome === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].runId).toBe(deal.runId);
  });

  it("ignores the agent's own outgoing mail so replies cannot loop", async () => {
    const h = createHarness({ voice: [] });
    const id = h.gmail.deliver({
      bodyText: "Re: your deal",
      fromEmail: "inbox@novacrm.io",
      generatedByAgent: true,
      subject: "Re: Deal closed",
    });

    const result = await registerMessage(h.deps, id);

    expect(result.status).toBe("ignored");
    expect(await h.store.deals.listDeals()).toEqual([]);
  });
});

describe("a second email for the same opportunity", () => {
  it("is blocked before anyone is called, and escalated", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const first = await h.run();
    expect(first.outcome).toBe("COMPLETE");

    // The AE forwards the same deal again as a brand new email.
    const second = await h.run(
      dealEmail({ extra: ["(forwarding again, just in case)"] })
    );

    expect(second.outcome).toBe("DUPLICATE_BLOCKED");
    expect(h.voice.placed).toHaveLength(1);
    expect(h.rocketlane.projects).toHaveLength(1);
    expect(h.slack.channels.size).toBe(1);
    const duplicate = await h.deal(second.messageId);
    expect(duplicate.state).toBe("DUPLICATE_BLOCKED");
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("DUPLICATE_PROJECT");
    expect(escalation.detail).toContain(first.messageId);
  });
});

describe("retried steps", () => {
  it("never dial twice for the same attempt", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId } = await h.receive();
    await h.steps.begin(messageId, WORKFLOW_RUN_ID);
    await h.steps.parseAndValidate(messageId);

    const first = await h.steps.placeCall(messageId, 1);
    const second = await h.steps.placeCall(messageId, 1);

    expect(first.status).toBe("dialed");
    expect(second).toEqual(first);
    expect(h.voice.placed).toHaveLength(1);
  });

  it("do not re-parse or re-ask the AE when validation is re-run", async () => {
    const h = createHarness();
    const { messageId } = await h.receive(dealEmail({ contactEmail: null }));

    const first = await h.steps.parseAndValidate(messageId);
    const second = await h.steps.parseAndValidate(messageId);

    expect(first.status).toBe("needs_clarification");
    expect(second.status).toBe("needs_clarification");
    expect(h.gmail.replies).toHaveLength(1);
    expect(h.parseCalls()).toBe(1);
  });

  it("make re-running a finished workflow a harmless no-op", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId } = await h.run();

    const outcome = await runOnboarding(
      { dealId: messageId, workflowRunId: WORKFLOW_RUN_ID },
      h.steps,
      h.runtime
    );

    expect(outcome).toBe("COMPLETE");
    expect(h.voice.placed).toHaveLength(1);
    expect(h.rocketlane.createRequests).toHaveLength(1);
    expect(h.slack.channels.size).toBe(1);
    expect(h.slack.posts).toHaveLength(1);
  });
});
