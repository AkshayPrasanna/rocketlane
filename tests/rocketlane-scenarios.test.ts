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
