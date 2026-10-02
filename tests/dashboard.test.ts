import { describe, expect, it } from "vitest";
import { REASON_LABELS, stepLabel } from "@/lib/dashboard/labels";
import {
  computeStats,
  createDashboardQueries,
  customerLabel,
} from "@/lib/dashboard/queries";
import { resolveEscalation } from "@/lib/dashboard/resolve";
import {
  buildProgress,
  MAIN_PATH,
  needsAttention,
  STATE_META,
} from "@/lib/dashboard/state-meta";
import { newDeal } from "@/lib/domain/deal";
import { ESCALATION_REASONS } from "@/lib/domain/schemas";
import { DEAL_STATES } from "@/lib/domain/states";
import { SimulatedSlackClient } from "@/lib/integrations/slack/simulated";
import type { CallScript } from "@/lib/integrations/voice/mock";
import { dealEmail } from "./helpers/emails";
import { createHarness, FIXED_NOW } from "./helpers/harness";

const NO_ANSWER: CallScript = { kind: "terminal", outcome: "no_answer" };

function statuses(deal: Parameters<typeof buildProgress>[0]) {
  return buildProgress(deal).map((step) => step.status);
}

describe("progress along the happy path", () => {
  it("shows a finished deal as all done", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });
    const { messageId } = await h.run();

    expect(statuses(await h.deal(messageId))).toEqual(
      new Array(MAIN_PATH.length).fill("done")
    );
  });

  it("marks where a deal waiting on the AE stopped", async () => {
    const h = createHarness();
    const { messageId } = await h.run(dealEmail({ contactEmail: null }));

    const steps = buildProgress(await h.deal(messageId));

    expect(steps.map((s) => s.status)).toEqual([
      "done",
      "done",
      "stopped",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(steps[2].label).toBe("Validated");
  });

  it("marks an unanswered call as stopped at tier confirmation", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });
    const { messageId } = await h.run();

    const steps = buildProgress(await h.deal(messageId));

    expect(steps.slice(0, 4).every((s) => s.status === "done")).toBe(true);
    expect(steps[4]).toEqual({ label: "Tier confirmed", status: "stopped" });
  });

  it("marks a Rocketlane failure as stopped at project creation, keeping the tier", async () => {
    const h = createHarness({ voice: [{ kind: "confirmed", tier: "growth" }] });
    h.rocketlane.faults.armDown("createProject");
    const { messageId } = await h.run();

    const steps = buildProgress(await h.deal(messageId));

    expect(steps[4].status).toBe("done");
    expect(steps[5]).toEqual({ label: "Project created", status: "stopped" });
  });

  it("marks a deal still running as current, not stopped", async () => {
    const h = createHarness({ voice: [{ kind: "confirmed", tier: "growth" }] });
    const { messageId } = await h.receive();
    await h.steps.parseAndValidate(messageId);

    const steps = buildProgress(await h.deal(messageId));

    expect(steps[3].status).toBe("current");
  });

  it("describes every state and escalation reason", () => {
    for (const state of DEAL_STATES) {
      expect(STATE_META[state].label.length).toBeGreaterThan(0);
    }
    for (const reason of ESCALATION_REASONS) {
      expect(REASON_LABELS[reason].length).toBeGreaterThan(0);
    }
    expect(stepLabel("place_call")).toBe("Call the AE");
    expect(stepLabel("some_new_step")).toBe("some new step");
  });

  it("flags only the states that need attention", () => {
    expect(needsAttention("ESCALATED_TO_HUMAN")).toBe(true);
    expect(needsAttention("NEEDS_CLARIFICATION")).toBe(true);
    expect(needsAttention("COMPLETE")).toBe(false);
    expect(needsAttention("CALLING_AE")).toBe(false);
  });
});

describe("overview stats", () => {
  it("groups deals into complete, needs-a-human, waiting-on-AE and in-progress", () => {
    const make = (id: string, state: ReturnType<typeof newDeal>["state"]) => ({
      ...newDeal(
        {
          aeEmail: "a@b.co",
          gmailMessageId: id,
          gmailThreadId: null,
          subject: null,
        },
        FIXED_NOW
      ),
      state,
    });

    const stats = computeStats([
      make("1", "COMPLETE"),
      make("2", "ESCALATED_TO_HUMAN"),
      make("3", "DUPLICATE_BLOCKED"),
      make("4", "ROCKETLANE_FAILED"),
      make("5", "NEEDS_CLARIFICATION"),
      make("6", "CALLING_AE"),
      make("7", "RECEIVED"),
    ]);

    expect(stats).toEqual({
      awaitingAe: 1,
      complete: 1,
      inProgress: 2,
      needsHuman: 3,
      total: 7,
    });
  });
});

describe("dashboard queries", () => {
  it("lists deals newest first with the AE address masked", async () => {
    const h = createHarness({ voice: [] });
    await h.run(dealEmail({ customer: null }));
    const queries = createDashboardQueries(h.store);

    const { rows, stats } = await queries.dealRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].aeEmail).toBe("r***@novacrm.io");
    expect(stats.awaitingAe).toBe(1);
  });

  it("labels an unparsed deal by its subject", () => {
    const deal = newDeal(
      {
        aeEmail: null,
        gmailMessageId: "x",
        gmailThreadId: null,
        subject: "Deal closed: Mystery",
      },
      FIXED_NOW
    );

    expect(customerLabel(deal)).toBe("Deal closed: Mystery");
  });

  it("returns a deal's audit trail, escalations and simulated Slack channel", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });
    h.deps.slack = new SimulatedSlackClient(h.store.slack, {
      clock: h.deps.clock,
      newId: h.deps.newId,
    });
    const { messageId } = await h.run();
    const queries = createDashboardQueries(h.store);

    const detail = await queries.dealDetail(messageId);

    expect(detail?.audit.length).toBeGreaterThan(5);
    expect(detail?.channel?.name).toBe("onb-acme-corp-enterprise");
    expect(detail?.channel?.topic).toContain("Enterprise plan");
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0].text).toContain(
      "Welcome to your onboarding channel"
    );
  });

  it("returns null for an unknown deal", async () => {
    const h = createHarness();

    expect(await createDashboardQueries(h.store).dealDetail("nope")).toBeNull();
  });

  it("puts open escalations before resolved ones", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });
    const first = await h.run();
    await h.run(
      dealEmail({
        opportunityUrl:
          "https://x.lightning.force.com/lightning/r/Opportunity/006Ux000002ZzZzIAK/view",
      })
    );
    // The second email is a different opportunity but the voice script is exhausted, so it
    // also ends in an escalation; resolve the first one.
    const [firstEscalation] = (await h.store.deals.listEscalations()).filter(
      (e) => e.dealId === first.messageId
    );
    await resolveEscalation(h.store, firstEscalation.id, "priya");

    const rows = await createDashboardQueries(h.store).escalationRows();

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].escalation.resolvedAt).toBeNull();
    expect(rows.at(-1)?.escalation.resolvedBy).toBe("priya");
    expect(rows.at(-1)?.customerName).toBe("Acme Corp");
  });

  it("lists simulated Slack channels with their messages and invites", async () => {
    const h = createHarness({ voice: [{ kind: "confirmed", tier: "growth" }] });
    h.deps.slack = new SimulatedSlackClient(h.store.slack, {
      clock: h.deps.clock,
      newId: h.deps.newId,
    });
    await h.run();

    const channels = await createDashboardQueries(h.store).slackChannels();

    expect(channels).toHaveLength(1);
    expect(channels[0].invites).toHaveLength(1);
    expect(channels[0].messages).toHaveLength(1);
  });
});

describe("resolving an escalation", () => {
  it("marks it resolved and records the human decision in the deal's audit trail", async () => {
    const h = createHarness({ voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] });
    const { messageId } = await h.run();
    const [escalation] = await h.store.deals.listEscalations({
      openOnly: true,
    });

    const resolved = await resolveEscalation(h.store, escalation.id, "priya");

    expect(resolved?.resolvedBy).toBe("priya");
    expect(await h.store.deals.listEscalations({ openOnly: true })).toEqual([]);
    const entries = await h.store.audit.listByDeal(messageId);
    const human = entries.find((e) => e.step === "resolve_escalation");
    expect(human?.agent).toBe("human");
    expect(human?.rationale).toContain("priya");
  });

  it("returns null for an unknown escalation and writes nothing", async () => {
    const h = createHarness();

    expect(await resolveEscalation(h.store, "nope", "priya")).toBeNull();
    expect(await h.store.audit.listAll()).toEqual([]);
  });
});
