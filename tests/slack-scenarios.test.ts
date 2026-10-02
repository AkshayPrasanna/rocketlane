import { describe, expect, it } from "vitest";
import { dealMarker } from "@/lib/communication/messages";
import { dealEmail } from "./helpers/emails";
import { createHarness, OPS_CHANNEL } from "./helpers/harness";

const ENTERPRISE = [{ kind: "confirmed", tier: "enterprise" }] as const;

describe("Slack channel name collision", () => {
  it("suffixes the name when an unrelated channel already has it", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const foreign = h.slack.seedChannel(
      "onb-acme-corp-enterprise",
      "someone else's channel"
    );

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    expect(deal.channel?.channelName).toBe("onb-acme-corp-enterprise-2");
    // We must not have touched the other channel.
    expect(h.slack.posts.some((p) => p.channelId === foreign.channelId)).toBe(
      false
    );
    expect(h.slack.topics.has(foreign.channelId)).toBe(false);
    const entries = await h.store.audit.listByDeal(messageId);
    const created = entries.find((e) => e.step === "create_channel");
    expect(JSON.stringify(created?.output)).toContain('"nameCollisions":1');
  });

  it("keeps counting up past several collisions", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.slack.seedChannel("onb-acme-corp-enterprise");
    h.slack.seedChannel("onb-acme-corp-enterprise-2");
    h.slack.seedChannel("onb-acme-corp-enterprise-3");

    const { messageId } = await h.run();

    expect((await h.deal(messageId)).channel?.channelName).toBe(
      "onb-acme-corp-enterprise-4"
    );
  });

  it("reuses a channel that already belongs to this deal", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const { messageId } = await h.receive();
    const ours = h.slack.seedChannel(
      "onb-acme-corp-enterprise",
      `earlier attempt ${dealMarker(messageId)}`
    );
    // The workflow starts after registration.
    const { runOnboarding } = await import("@/lib/pipeline/orchestrator");
    const outcome = await runOnboarding(
      { dealId: messageId, workflowRunId: "wf-1" },
      h.steps,
      h.runtime
    );

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    expect(deal.channel?.channelId).toBe(ours.channelId);
    expect(h.slack.channels.size).toBe(1);
  });

  it("gives two customers with the same name their own channels", async () => {
    const h = createHarness({
      voice: [...ENTERPRISE, ...ENTERPRISE],
    });
    const first = await h.run();
    expect(first.outcome).toBe("COMPLETE");
    // A different opportunity for a customer with the same name; clear the Rocketlane
    // duplicate guard so only the Slack collision is exercised.
    h.rocketlane.projects.length = 0;

    const second = await h.run(
      dealEmail({
        opportunityUrl:
          "https://novacrm.lightning.force.com/lightning/r/Opportunity/006Ux000002ZzZzIAK/view",
      })
    );

    expect(second.outcome).toBe("COMPLETE");
    expect((await h.deal(first.messageId)).channel?.channelName).toBe(
      "onb-acme-corp-enterprise"
    );
    expect((await h.deal(second.messageId)).channel?.channelName).toBe(
      "onb-acme-corp-enterprise-2"
    );
  });
});

describe("Slack failures after the project exists", () => {
  it("escalates, and keeps the project, when Slack stays down", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.slack.faults.armDown("createChannel", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    expect(h.sleeps).toEqual([5, 10, 20]);
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("ESCALATED_TO_HUMAN");
    expect(deal.project).not.toBeNull();
    expect(h.rocketlane.projects).toHaveLength(1);
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("SLACK_FAILURE");
    expect(escalation.detail).toContain(deal.project?.projectId ?? "missing");
  });

  it("posts the welcome message once even when a retry follows a failed post", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.slack.faults.arm("postMessage", { kind: "server_error" });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.slack.channels.size).toBe(1);
    const channelId = (await h.deal(messageId)).channel?.channelId;
    const welcomes = h.slack.posts.filter((p) => p.channelId === channelId);
    expect(welcomes).toHaveLength(1);
    expect(h.slack.posts.some((p) => p.channelId === OPS_CHANNEL)).toBe(false);
  });

  it("carries on when only the customer invite fails", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.slack.faults.armDown("inviteExternalUser", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const entries = await h.store.audit.listByDeal(messageId);
    const invite = entries.find((e) => e.step === "invite_customer");
    expect(invite?.outcome).toBe("failure");
  });

  it("still queues the escalation when the ops alert itself cannot be sent", async () => {
    const h = createHarness({
      voice: [
        { kind: "terminal", outcome: "no_answer" },
        { kind: "terminal", outcome: "no_answer" },
        { kind: "terminal", outcome: "no_answer" },
      ],
    });
    h.slack.faults.armDown("postMessage", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ESCALATED_TO_HUMAN");
    const [escalation] = await h.store.deals.listEscalations({
      openOnly: true,
    });
    expect(escalation.opsNotified).toBe(false);
    const entries = await h.store.audit.listByDeal(messageId);
    expect(
      entries.some((e) => e.step === "ops_alert" && e.outcome === "failure")
    ).toBe(true);
  });
});
