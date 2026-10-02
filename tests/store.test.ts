import { beforeEach, describe, expect, it } from "vitest";
import { newDeal } from "@/lib/domain/deal";
import type { Escalation } from "@/lib/domain/schemas";
import { InvalidTransitionError } from "@/lib/domain/states";
import { createMemoryStore } from "@/lib/store/get-store";
import type { Store } from "@/lib/store/types";

const T0 = new Date("2026-10-02T10:00:00.000Z");

function deal(messageId: string, createdAt: Date = T0) {
  return newDeal(
    {
      aeEmail: "ae@novacrm.io",
      gmailMessageId: messageId,
      gmailThreadId: `thread-${messageId}`,
      subject: "Deal closed",
    },
    createdAt
  );
}

function escalation(id: string, dealId: string): Escalation {
  return {
    createdAt: T0.toISOString(),
    dealId,
    detail: "AE did not answer 3 times",
    id,
    opsNotified: true,
    reason: "CALL_RETRIES_EXHAUSTED",
    resolvedAt: null,
    resolvedBy: null,
  };
}

let store: Store;
let now: Date;

beforeEach(() => {
  now = T0;
  store = createMemoryStore(() => now);
});

describe("idempotency claims", () => {
  it("lets exactly one delivery claim a Gmail message", async () => {
    expect(await store.deals.claimMessage("m1", "m1")).toBe(true);
    expect(await store.deals.claimMessage("m1", "m1")).toBe(false);
    expect(await store.deals.claimMessage("m2", "m2")).toBe(true);
  });

  it("blocks a second deal for the same Salesforce opportunity", async () => {
    expect(await store.deals.claimOpportunity("006ABC", "m1")).toEqual({
      claimed: true,
    });
    expect(await store.deals.claimOpportunity("006ABC", "m2")).toEqual({
      claimed: false,
      existingDealId: "m1",
    });
  });

  it("lets the same deal re-claim its own opportunity", async () => {
    await store.deals.claimOpportunity("006ABC", "m1");

    expect(await store.deals.claimOpportunity("006ABC", "m1")).toEqual({
      claimed: true,
    });
  });

  it("accepts each call event once per execution", async () => {
    expect(await store.deals.claimCallEvent("exec-1", "terminal")).toBe(true);
    expect(await store.deals.claimCallEvent("exec-1", "terminal")).toBe(false);
    expect(await store.deals.claimCallEvent("exec-2", "terminal")).toBe(true);
  });
});

describe("deals", () => {
  it("creates a deal in RECEIVED and refuses to overwrite it", async () => {
    expect(await store.deals.createDeal(deal("m1"))).toBe(true);

    expect((await store.deals.getDeal("m1"))?.state).toBe("RECEIVED");
    expect(await store.deals.createDeal(deal("m1"))).toBe(false);
  });

  it("returns null for an unknown deal", async () => {
    expect(await store.deals.getDeal("nope")).toBeNull();
  });

  it("applies legal transitions and stamps updatedAt", async () => {
    await store.deals.createDeal(deal("m1"));
    now = new Date("2026-10-02T10:05:00.000Z");

    const next = await store.deals.transitionDeal("m1", "PARSED", {
      stateReason: "Parsed by model",
    });

    expect(next.state).toBe("PARSED");
    expect(next.stateReason).toBe("Parsed by model");
    expect(next.updatedAt).toBe("2026-10-02T10:05:00.000Z");
    expect(next.createdAt).toBe(T0.toISOString());
  });

  it("rejects an illegal transition and leaves the deal untouched", async () => {
    await store.deals.createDeal(deal("m1"));

    await expect(
      store.deals.transitionDeal("m1", "PROJECT_CREATED")
    ).rejects.toThrow(InvalidTransitionError);
    expect((await store.deals.getDeal("m1"))?.state).toBe("RECEIVED");
  });

  it("updates fields without changing state", async () => {
    await store.deals.createDeal(deal("m1"));

    const updated = await store.deals.updateDeal("m1", {
      callAttempts: 2,
      planTier: "growth",
    });

    expect(updated.state).toBe("RECEIVED");
    expect(updated.callAttempts).toBe(2);
    expect(updated.planTier).toBe("growth");
  });

  it("throws when updating a deal that does not exist", async () => {
    await expect(
      store.deals.updateDeal("ghost", { callAttempts: 1 })
    ).rejects.toThrow("not found");
  });

  it("lists deals newest first and honours the limit", async () => {
    await store.deals.createDeal(deal("old", new Date("2026-10-01T00:00:00Z")));
    await store.deals.createDeal(deal("new", new Date("2026-10-03T00:00:00Z")));
    await store.deals.createDeal(deal("mid", new Date("2026-10-02T00:00:00Z")));

    expect((await store.deals.listDeals()).map((d) => d.dealId)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(await store.deals.listDeals(1)).toHaveLength(1);
  });
});

describe("escalations", () => {
  it("lists open escalations and hides resolved ones on request", async () => {
    await store.deals.createEscalation(escalation("e1", "m1"));
    await store.deals.createEscalation(escalation("e2", "m2"));
    await store.deals.resolveEscalation("e1", "priya");

    expect(await store.deals.listEscalations()).toHaveLength(2);
    const open = await store.deals.listEscalations({ openOnly: true });
    expect(open.map((e) => e.id)).toEqual(["e2"]);
  });

  it("records who resolved it and when", async () => {
    await store.deals.createEscalation(escalation("e1", "m1"));
    now = new Date("2026-10-02T11:00:00.000Z");

    const resolved = await store.deals.resolveEscalation("e1", "priya");

    expect(resolved?.resolvedBy).toBe("priya");
    expect(resolved?.resolvedAt).toBe("2026-10-02T11:00:00.000Z");
  });

  it("returns null when resolving an unknown escalation", async () => {
    expect(await store.deals.resolveEscalation("nope", "priya")).toBeNull();
  });
});

describe("workflow start lease", () => {
  it("lets one caller start the workflow and blocks the rest", async () => {
    expect(await store.deals.claimWorkflowStart("m1", 120)).toBe(true);
    expect(await store.deals.claimWorkflowStart("m1", 120)).toBe(false);
  });

  it("lets a later caller retry once the lease is released", async () => {
    await store.deals.claimWorkflowStart("m1", 120);

    await store.deals.releaseWorkflowStart("m1");

    expect(await store.deals.claimWorkflowStart("m1", 120)).toBe(true);
  });
});

describe("mail bridge store", () => {
  const reply = (id: string, queuedAt: string) => ({
    bodyText: "Please send the missing details",
    id,
    inReplyTo: "<abc@mail.test>",
    messageId: "msg-1",
    queuedAt,
    subject: "Re: Deal closed",
    threadId: "thread-1",
    to: "ae@novacrm.io",
  });

  it("returns pending replies oldest first and forgets acked ones", async () => {
    await store.mail.queueReply(reply("r2", "2026-10-02T10:02:00.000Z"));
    await store.mail.queueReply(reply("r1", "2026-10-02T10:01:00.000Z"));

    expect((await store.mail.listPendingReplies(10)).map((r) => r.id)).toEqual([
      "r1",
      "r2",
    ]);

    await store.mail.ackReplies(["r1", "never-existed"]);
    await store.mail.ackReplies(["r1"]);

    expect((await store.mail.listPendingReplies(10)).map((r) => r.id)).toEqual([
      "r2",
    ]);
  });

  it("honours the page size", async () => {
    await store.mail.queueReply(reply("r1", "2026-10-02T10:01:00.000Z"));
    await store.mail.queueReply(reply("r2", "2026-10-02T10:02:00.000Z"));

    expect(await store.mail.listPendingReplies(1)).toHaveLength(1);
  });
});

describe("call executions", () => {
  it("maps an execution back to its deal and hook", async () => {
    const mapping = {
      attempt: 2,
      dealId: "m1",
      executionId: "exec-1",
      hookToken: "call:m1:2",
    };
    await store.deals.saveCallExecution(mapping);

    expect(await store.deals.getCallExecution("exec-1")).toEqual(mapping);
    expect(await store.deals.getCallExecution("exec-9")).toBeNull();
  });
});
