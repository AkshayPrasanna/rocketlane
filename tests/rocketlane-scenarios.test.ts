import { describe, expect, it } from "vitest";
import {
  IntegrationError,
  type IntegrationErrorKind,
} from "@/lib/integrations/errors";
import { MockRocketlaneClient } from "@/lib/integrations/rocketlane/mock";
import type { CreateProjectInput } from "@/lib/integrations/rocketlane/types";
import { OPPORTUNITY_ID } from "./helpers/emails";
import { createHarness, OPS_CHANNEL } from "./helpers/harness";

const ENTERPRISE = [{ kind: "confirmed", tier: "enterprise" }] as const;

describe("Rocketlane API is down", () => {
  it("retries with backoff, then escalates and never reports success", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("createProject", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    // 4 attempts means 3 waits, doubling from the 5 second base.
    expect(h.sleeps).toEqual([5, 10, 20]);
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("ROCKETLANE_FAILED");
    expect(deal.project).toBeNull();
    expect(h.rocketlane.projects).toHaveLength(0);
    // The customer must not hear about a project that doesn't exist.
    expect(h.slack.channels.size).toBe(0);
    expect(h.slack.invites).toHaveLength(0);
  });

  it("escalates with the full context a human needs", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("createProject", "server_error");

    const { messageId } = await h.run();

    const [escalation] = await h.store.deals.listEscalations({
      openOnly: true,
    });
    expect(escalation).toMatchObject({
      dealId: messageId,
      opsNotified: true,
      reason: "ROCKETLANE_FAILURE",
    });
    expect(escalation.detail).toContain("4 attempt(s)");
    expect(escalation.detail).toContain("server_error");
    expect(escalation.detail).toContain("enterprise");
    expect(escalation.detail).toContain(OPPORTUNITY_ID);
    expect(h.slack.posts.some((p) => p.channelId === OPS_CHANNEL)).toBe(true);
  });

  it("recovers from transient 500s without creating anything twice", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.arm("createProject", {
      kind: "server_error",
      times: 2,
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.sleeps).toEqual([5, 10]);
    expect(h.rocketlane.projects).toHaveLength(1);
  });

  it("waits at least as long as Rocketlane asks when rate limited", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.arm("createProject", {
      kind: "rate_limited",
      retryAfterMs: 30_000,
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.sleeps).toEqual([30]);
  });

  it("does not retry bad credentials", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("createProject", "unauthorized");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    expect(h.sleeps).toEqual([]);
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.detail).toContain("unauthorized");
    expect(escalation.detail).toContain("401");
    expect((await h.deal(messageId)).state).toBe("ROCKETLANE_FAILED");
  });

  it("does not retry a rejected request", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("createProject", "bad_request");

    const { outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    expect(h.sleeps).toEqual([]);
  });

  it.each([
    "server_error",
    "timeout",
    "network",
  ] as IntegrationErrorKind[])("retries %s on the duplicate check too", async (kind) => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.arm("findProjects", { kind });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.sleeps).toEqual([5]);
    expect(h.rocketlane.projects).toHaveLength(1);
  });

  it("does not report success when Rocketlane returns no project ID", async () => {
    class NoIdRocketlane extends MockRocketlaneClient {
      override createProject(input: CreateProjectInput) {
        return super.createProject(input).then((project) => ({
          ...project,
          projectId: "",
        }));
      }
    }
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.deps.rocketlane = new NoIdRocketlane();

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    expect((await h.deal(messageId)).project).toBeNull();
    expect(h.slack.channels.size).toBe(0);
  });
});

describe("customer already has a project", () => {
  it("blocks a duplicate found by customer name and escalates", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    const existing = h.rocketlane.seed({
      projectName: "Acme Corp - Legacy Onboarding",
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("DUPLICATE_BLOCKED");
    expect(h.rocketlane.createRequests).toHaveLength(0);
    expect(h.rocketlane.projects).toEqual([existing]);
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("DUPLICATE_BLOCKED");
    expect(deal.project).toBeNull();
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("DUPLICATE_PROJECT");
    expect(escalation.detail).toContain(existing.projectId);
    expect(h.slack.channels.size).toBe(0);
  });

  it("blocks a duplicate found by Salesforce opportunity ID", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.seed({
      externalReferenceId: OPPORTUNITY_ID,
      projectName: "Something completely different",
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("DUPLICATE_BLOCKED");
    expect(h.rocketlane.createRequests).toHaveLength(0);
  });

  it("matches the customer name case-insensitively", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.seed({ projectName: "ACME CORP onboarding" });

    const { outcome } = await h.run();

    expect(outcome).toBe("DUPLICATE_BLOCKED");
  });

  it("is not fooled by an unrelated customer", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.seed({ projectName: "Globex - Enterprise Onboarding" });

    const { outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.rocketlane.projects).toHaveLength(2);
  });
});

describe("interrupted project creation", () => {
  it("adopts the project it already made instead of creating a second one", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.loseNextCreateResponses(1);

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    // The first create reached Rocketlane but timed out; the retry must adopt it.
    expect(h.rocketlane.projects).toHaveLength(1);
    expect(h.rocketlane.createRequests).toHaveLength(1);
    const deal = await h.deal(messageId);
    expect(deal.project?.projectId).toBe(h.rocketlane.projects[0].projectId);
    const entries = await h.store.audit.listByDeal(messageId);
    expect(
      entries.some((e) => JSON.stringify(e.output).includes("adoptedProjectId"))
    ).toBe(true);
    expect(await h.store.deals.listEscalations()).toEqual([]);
  });

  it("still blocks a stranger's project when we never tried to create one", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.seed({
      externalReferenceId: OPPORTUNITY_ID,
      projectName: "Created by hand",
    });

    const { outcome } = await h.run();

    expect(outcome).toBe("DUPLICATE_BLOCKED");
  });
});

describe("a Rocketlane error carries through to the audit log", () => {
  it("records each failed attempt as a retry with the reason", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.arm("createProject", {
      kind: "server_error",
      message: "upstream exploded",
      times: 1,
    });

    const { messageId } = await h.run();

    const entries = await h.store.audit.listByDeal(messageId);
    const retry = entries.find(
      (e) => e.step === "create_project" && e.outcome === "retry"
    );
    expect(JSON.stringify(retry?.output)).toContain("upstream exploded");
    expect(retry?.rationale).toContain("nothing is marked successful");
  });

  it("uses IntegrationError retryability, not provider-specific rules", () => {
    expect(
      new IntegrationError("rocketlane", "server_error", "x").retryable
    ).toBe(true);
    expect(
      new IntegrationError("rocketlane", "rate_limited", "x").retryable
    ).toBe(true);
    expect(
      new IntegrationError("rocketlane", "unauthorized", "x").retryable
    ).toBe(false);
    expect(
      new IntegrationError("rocketlane", "bad_request", "x").retryable
    ).toBe(false);
  });
});

describe("the template Rocketlane used", () => {
  const enterpriseId = (h: ReturnType<typeof createHarness>) =>
    h.deps.settings.plans.enterprise.templateId;

  it("accepts a project built from the confirmed tier's template", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    expect(deal.project?.templateId).toBe(enterpriseId(h));
  });

  it("escalates a project built from a different template and does not retry it", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.reportedTemplateId = "999";

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    expect(h.rocketlane.createRequests).toHaveLength(1);
    expect(h.rocketlane.assignments).toHaveLength(0);
    const deal = await h.deal(messageId);
    expect(deal.project).toBeNull();
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("TEMPLATE_MISMATCH");
    expect(escalation.detail).toContain(h.rocketlane.projects[0].projectId);
    expect(escalation.detail).toContain("999");
    expect(h.slack.channels.size).toBe(0);
  });

  it("escalates when the template ID is right but Rocketlane names a different template", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    // The Enterprise ID now points at the Growth template: the "mixed up templates" failure.
    h.rocketlane.templateNames.set(
      enterpriseId(h),
      h.deps.settings.plans.growth.templateName
    );

    const { outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("TEMPLATE_MISMATCH");
    expect(escalation.detail).toContain("NovaCRM Growth Onboarding (14d)");
  });

  it("escalates when Rocketlane does not say which template it used", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.reportedTemplateId = null;

    const { outcome } = await h.run();

    expect(outcome).toBe("ROCKETLANE_FAILED");
    const [escalation] = await h.store.deals.listEscalations();
    expect(escalation.reason).toBe("TEMPLATE_MISMATCH");
    expect(escalation.detail).toContain("no template reported");
  });

  it("does not adopt an interrupted project that was built from another template", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.reportedTemplateId = "999";
    h.rocketlane.loseNextCreateResponses(1);

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("DUPLICATE_BLOCKED");
    const deal = await h.deal(messageId);
    expect(deal.project).toBeNull();
  });
});

describe("the Project Manager role", () => {
  it("is filled on every project so the 1-day overdue alert has a recipient", async () => {
    const h = createHarness({
      env: { ROCKETLANE_PM_EMAIL: "pm@novacrm.io" },
      voice: [...ENTERPRISE],
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.rocketlane.assignments).toEqual([
      {
        assignments: [{ email: "pm@novacrm.io", roleName: "Project Manager" }],
        projectId: h.rocketlane.projects[0].projectId,
      },
    ]);
    const entries = await h.store.audit.listByDeal(messageId);
    const entry = entries.find((e) => e.step === "assign_project_manager");
    expect(entry?.outcome).toBe("success");
    // The address is not copied into the audit log.
    expect(JSON.stringify(entry)).not.toContain("pm@novacrm.io");
  });

  it("still completes onboarding when the template has no such role, and says so", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.rolesMissingFromTemplate.add("Project Manager");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const entries = await h.store.audit.listByDeal(messageId);
    const entry = entries.find((e) => e.step === "assign_project_manager");
    expect(entry?.outcome).toBe("failure");
    expect(entry?.rationale).toContain("no recipient");
  });

  it("still completes onboarding when Rocketlane errors while assigning", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("assignPlaceholders", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const entries = await h.store.audit.listByDeal(messageId);
    const entry = entries.find((e) => e.step === "assign_project_manager");
    expect(entry?.outcome).toBe("failure");
    expect(JSON.stringify(entry?.output)).toContain("server_error");
  });
});

describe("the schedule Rocketlane reports", () => {
  const welcomeOf = (h: ReturnType<typeof createHarness>) =>
    h.slack.posts.find((post) => post.text.includes("Welcome"))?.text ?? "";

  it("is what the deal record and the Slack welcome show, not our calendar plan", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    // Rocketlane schedules template durations in working days, so it lands later than +30.
    h.rocketlane.schedules.set("rl-1", {
      dueDate: "2026-11-12",
      phases: [
        { endDate: "2026-10-06", name: "Kickoff", startDate: "2026-10-02" },
        {
          endDate: "2026-10-22",
          name: "Data Migration",
          startDate: "2026-10-07",
        },
        {
          endDate: "2026-11-05",
          name: "Configuration",
          startDate: "2026-10-23",
        },
        { endDate: "2026-11-12", name: "Go-Live", startDate: "2026-11-06" },
      ],
      startDate: "2026-10-02",
    });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    expect(deal.project?.dueDate).toBe("2026-11-12");
    expect(deal.project?.phases).toHaveLength(4);
    const channelId = deal.channel?.channelId ?? "";
    expect(h.slack.topics.get(channelId)).toContain("Go-live target 12 Nov");
    const welcome = welcomeOf(h);
    expect(welcome).toContain("*Go-Live*: 6 Nov to 12 Nov");
    expect(welcome).not.toContain("1 Nov");
  });

  it("falls back to the plan, and says so, when it cannot be read", async () => {
    const h = createHarness({ voice: [...ENTERPRISE] });
    h.rocketlane.faults.armDown("getSchedule", "server_error");

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    const deal = await h.deal(messageId);
    // The test clock is 2 Oct, so the 30-day plan ends 1 Nov.
    expect(deal.project?.dueDate).toBe("2026-11-01");
    const entries = await h.store.audit.listByDeal(messageId);
    const entry = entries.find((e) => e.step === "read_schedule");
    expect(entry?.outcome).toBe("failure");
    expect(entry?.rationale).toContain("planned dates");
    const channelId = deal.channel?.channelId ?? "";
    expect(h.slack.topics.get(channelId)).toContain("Go-live target 1 Nov");
  });
});
