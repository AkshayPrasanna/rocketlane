import { describe, expect, it } from "vitest";
import { ONBOARDING_PLANS } from "@/config/onboarding-plans";
import { parseEnv } from "@/lib/env";
import {
  assertDistinctTemplates,
  buildSettings,
} from "@/lib/pipeline/settings";
import { createHarness } from "./helpers/harness";

const CASES = [
  {
    csmKind: "dedicated",
    csmName: "Arjun Mehta",
    days: 30,
    dueDate: "2026-11-01",
    label: "Enterprise",
    templateId: "mock-template-enterprise",
    templateName: "NovaCRM Enterprise Onboarding (30d)",
    tier: "enterprise",
  },
  {
    csmKind: "pooled",
    csmName: "NovaCRM Growth CS Pod",
    days: 14,
    dueDate: "2026-10-16",
    label: "Growth",
    templateId: "mock-template-growth",
    templateName: "NovaCRM Growth Onboarding (14d)",
    tier: "growth",
  },
] as const;

describe("template accuracy", () => {
  it.each(
    CASES
  )("$tier: uses the $days-day template, $csmKind CSM and the right due date", async ({
    csmKind,
    csmName,
    dueDate,
    label,
    templateId,
    templateName,
    tier,
  }) => {
    const h = createHarness({ voice: [{ kind: "confirmed", tier }] });

    const { messageId, outcome } = await h.run();

    expect(outcome).toBe("COMPLETE");
    expect(h.rocketlane.createRequests).toHaveLength(1);
    expect(h.rocketlane.createRequests[0]).toMatchObject({
      dueDate,
      startDate: "2026-10-02",
      templateId,
    });
    const deal = await h.deal(messageId);
    expect(deal.project?.templateName).toBe(templateName);

    const channelId = deal.channel?.channelId ?? "";
    expect(deal.channel?.channelName).toContain(`-${tier}`);
    expect(h.slack.topics.get(channelId)).toContain(
      `${csmKind === "dedicated" ? "Dedicated" : "Pooled"} CSM: ${csmName}`
    );
    const welcome = h.slack.posts.find((p) => p.channelId === channelId)?.text;
    expect(welcome).toContain(`*${label}* plan`);
    expect(welcome).toContain(csmName);
  });

  it("never uses the other tier's template", async () => {
    const enterprise = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });
    const growth = createHarness({
      voice: [{ kind: "confirmed", tier: "growth" }],
    });

    await enterprise.run();
    await growth.run();

    expect(enterprise.rocketlane.createRequests[0].templateId).not.toBe(
      growth.rocketlane.createRequests[0].templateId
    );
    expect(enterprise.rocketlane.createRequests[0].templateId).not.toContain(
      "growth"
    );
    expect(growth.rocketlane.createRequests[0].templateId).not.toContain(
      "enterprise"
    );
  });

  it("defines a complete plan for every tier, with the right names and durations", () => {
    expect(ONBOARDING_PLANS.enterprise.durationDays).toBe(30);
    expect(ONBOARDING_PLANS.enterprise.csm.kind).toBe("dedicated");
    expect(ONBOARDING_PLANS.enterprise.templateName).toContain("Enterprise");
    expect(ONBOARDING_PLANS.enterprise.templateName).toContain("30d");
    expect(ONBOARDING_PLANS.growth.durationDays).toBe(14);
    expect(ONBOARDING_PLANS.growth.csm.kind).toBe("pooled");
    expect(ONBOARDING_PLANS.growth.templateName).toContain("Growth");
    expect(ONBOARDING_PLANS.growth.templateName).toContain("14d");
  });

  it("covers all four phases and ends on the plan's last day", () => {
    for (const plan of Object.values(ONBOARDING_PLANS)) {
      expect(plan.phases.map((p) => p.name)).toEqual([
        "Kickoff",
        "Data Migration",
        "Configuration",
        "Go-Live",
      ]);
      expect(plan.phases.at(-1)?.endDay).toBe(plan.durationDays);
      for (const [index, phase] of plan.phases.entries()) {
        expect(phase.endDay).toBeGreaterThanOrEqual(phase.startDay);
        if (index > 0) {
          expect(phase.startDay).toBe(plan.phases[index - 1].endDay + 1);
        }
      }
    }
  });

  it("refuses to start when both tiers point at the same template", () => {
    const plans = buildSettings(parseEnv({})).plans;

    expect(() =>
      assertDistinctTemplates({
        enterprise: plans.enterprise,
        growth: { ...plans.growth, templateId: plans.enterprise.templateId },
      })
    ).toThrow("must be different templates");
    expect(() =>
      buildSettings(
        parseEnv({
          ROCKETLANE_TEMPLATE_ID_ENTERPRISE: "42",
          ROCKETLANE_TEMPLATE_ID_GROWTH: "42",
        })
      )
    ).toThrow("must be different templates");
  });

  it("requires real template IDs and an owner when Rocketlane is live", () => {
    expect(() => buildSettings(parseEnv({ ROCKETLANE_MODE: "live" }))).toThrow(
      "ROCKETLANE_MODE=live requires"
    );
    const complete = {
      ROCKETLANE_MODE: "live",
      ROCKETLANE_OWNER_EMAIL: "cs@novacrm.io",
      ROCKETLANE_PM_EMAIL: "pm@novacrm.io",
      ROCKETLANE_TEMPLATE_ID_ENTERPRISE: "101",
      ROCKETLANE_TEMPLATE_ID_GROWTH: "102",
    };
    expect(() => buildSettings(parseEnv(complete))).not.toThrow();
    // Without a Project Manager the overdue alert would have no recipient.
    const { ROCKETLANE_PM_EMAIL: _pm, ...withoutPm } = complete;
    expect(() => buildSettings(parseEnv(withoutPm))).toThrow(
      "ROCKETLANE_PM_EMAIL"
    );
  });

  it("lets a deployment rename the CSMs without touching the plan definitions", () => {
    const settings = buildSettings(
      parseEnv({
        ENTERPRISE_CSM_NAME: "Dana Rao",
        GROWTH_CSM_POOL_NAME: "Growth Pod B",
      })
    );

    expect(settings.plans.enterprise.csmName).toBe("Dana Rao");
    expect(settings.plans.growth.csmName).toBe("Growth Pod B");
  });
});
