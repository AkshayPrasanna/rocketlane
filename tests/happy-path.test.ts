import { describe, expect, it } from "vitest";
import { AE, OPPORTUNITY_ID } from "./helpers/emails";
import { createHarness, OPS_CHANNEL } from "./helpers/harness";

describe("happy path: Enterprise deal", () => {
  it("parses the email, confirms by voice, creates the project and the Slack channel", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("COMPLETE");
    expect(deal.planTier).toBe("enterprise");
    expect(deal.callAttempts).toBe(1);
    expect(deal.parsed?.customerName).toBe("Acme Corp");
    expect(deal.parsed?.opportunityId).toBe(OPPORTUNITY_ID);
  });

  it("calls the AE at the directory number, not a number from the email", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    await h.run();

    expect(h.voice.placed).toHaveLength(1);
    expect(h.voice.placed[0]).toMatchObject({
      aeName: AE.name,
      aePhone: AE.phone,
      customerName: "Acme Corp",
    });
  });

  it("creates the project from the Enterprise template with the right dates", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId } = await h.run();

    expect(h.rocketlane.createRequests).toHaveLength(1);
    expect(h.rocketlane.createRequests[0]).toMatchObject({
      customerName: "Acme Corp",
      dueDate: "2026-11-01",
      externalReferenceId: OPPORTUNITY_ID,
      projectName: "Acme Corp - Enterprise Onboarding",
      startDate: "2026-10-02",
      templateId: "mock-template-enterprise",
    });
    const deal = await h.deal(messageId);
    expect(deal.project?.templateName).toBe(
      "NovaCRM Enterprise Onboarding (30d)"
    );
  });

  it("creates a personalised Slack channel with topic and welcome message", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId } = await h.run();

    const deal = await h.deal(messageId);
    expect(deal.channel?.channelName).toBe("onb-acme-corp-enterprise");
    const channelId = deal.channel?.channelId ?? "";
    expect(h.slack.topics.get(channelId)).toContain(
      "Enterprise plan (30 days)"
    );
    expect(h.slack.topics.get(channelId)).toContain(
      "Dedicated CSM: Arjun Mehta"
    );

    const welcome =
      h.slack.posts.find((p) => p.channelId === channelId)?.text ?? "";
    expect(welcome).toContain("Acme Corp");
    expect(welcome).toContain("30-day");
    expect(welcome).toContain("dedicated CSM, Arjun Mehta");
    expect(welcome).toContain(AE.name);
    expect(welcome).toContain("Kickoff");
    expect(welcome).toContain("Go-Live");
    expect(welcome).toContain("1 Nov");
    expect(welcome).toContain(deal.project?.projectUrl ?? "missing");
    expect(welcome).toContain("kickoff call");
  });

  it("records the customer invite as simulated and replies to the AE", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId } = await h.run();

    expect(h.slack.invites).toHaveLength(1);
    expect(h.slack.invites[0].email).toBe("jane.doe@acme.com");
    expect(h.gmail.replies).toHaveLength(1);
    expect(h.gmail.replies[0].to).toBe(AE.email);
    expect(h.gmail.replies[0].bodyText).toContain("onb-acme-corp-enterprise");
    expect(h.gmail.labelsApplied).toContainEqual({
      label: h.deps.settings.gmailProcessedLabel,
      messageId,
    });
  });

  it("raises no escalation and no ops alert", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    await h.run();

    expect(await h.store.deals.listEscalations()).toEqual([]);
    expect(h.slack.posts.some((p) => p.channelId === OPS_CHANNEL)).toBe(false);
  });

  it("logs each step in order", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId } = await h.run();

    expect(await h.auditSteps(messageId)).toEqual([
      "receive_email",
      "verify_sender",
      "workflow_started",
      "parse_email",
      "validate_deal",
      "place_call",
      "evaluate_call",
      "assign_project_manager",
      "read_schedule",
      "create_project",
      "create_channel",
      "post_welcome",
      "invite_customer",
      "complete",
    ]);
  });

  it("opens the call hook before dialling", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    const { messageId } = await h.run();

    expect(h.waitersOpened).toEqual([
      { attempt: 1, hookToken: `call:${messageId}:1` },
    ]);
  });
});
