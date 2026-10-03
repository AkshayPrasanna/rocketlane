import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PLANS,
  PROJECT_MANAGER_ROLE,
} from "@/config/onboarding-plans";
import { RocketlaneApiClient } from "@/lib/integrations/rocketlane/live";

const {
  ROCKETLANE_API_KEY,
  ROCKETLANE_BASE_URL,
  ROCKETLANE_OWNER_EMAIL,
  ROCKETLANE_PM_EMAIL,
  ROCKETLANE_PROJECT_URL_TEMPLATE,
  ROCKETLANE_TEMPLATE_ID_ENTERPRISE,
  ROCKETLANE_TEMPLATE_ID_GROWTH,
} = process.env;

function liveClient(): RocketlaneApiClient {
  if (!ROCKETLANE_API_KEY) {
    throw new Error("Set ROCKETLANE_API_KEY in .env.local");
  }
  return new RocketlaneApiClient({
    apiKey: ROCKETLANE_API_KEY,
    baseUrl: ROCKETLANE_BASE_URL,
    projectUrlTemplate: ROCKETLANE_PROJECT_URL_TEMPLATE,
  });
}

/** Read-only: needs ROCKETLANE_API_KEY. Safe to run any time. */
describe("the real Rocketlane sandbox (read-only)", () => {
  it.skipIf(!ROCKETLANE_API_KEY)(
    "finds the sample project by customer name",
    async () => {
      const found = await liveClient().findProjects({ nameContains: "acme" });

      expect(found.length).toBeGreaterThan(0);
      for (const project of found) {
        expect(project.projectName.toLowerCase()).toContain("acme");
      }
    }
  );

  it.skipIf(!ROCKETLANE_API_KEY)(
    "finds nothing for an opportunity that has no project",
    async () => {
      const found = await liveClient().findProjects({
        externalReferenceId: "006-no-such-opportunity",
      });

      expect(found).toEqual([]);
    }
  );
});

/**
 * Creates ONE throwaway project per template in the sandbox and checks that Rocketlane built
 * it from the template you meant. It writes real data, so it only runs when you ask:
 *
 *   VERIFY_TEMPLATES=yes pnpm test:live tests/live/rocketlane.live.test.ts
 *
 * Needs both template IDs, ROCKETLANE_OWNER_EMAIL and ROCKETLANE_PM_EMAIL in .env.local.
 * Delete the "[verify]" projects afterwards from the Rocketlane UI.
 */
describe("the real Rocketlane templates", () => {
  const tiers = [
    ["enterprise", ROCKETLANE_TEMPLATE_ID_ENTERPRISE],
    ["growth", ROCKETLANE_TEMPLATE_ID_GROWTH],
  ] as const;

  for (const [tier, templateId] of tiers) {
    it.skipIf(process.env.VERIFY_TEMPLATES !== "yes")(
      `builds a ${tier} project from the ${tier} template`,
      async () => {
        if (!(templateId && ROCKETLANE_OWNER_EMAIL && ROCKETLANE_PM_EMAIL)) {
          throw new Error(
            "Set the template IDs, ROCKETLANE_OWNER_EMAIL and ROCKETLANE_PM_EMAIL in .env.local"
          );
        }
        const plan = ONBOARDING_PLANS[tier];
        const client = liveClient();
        const stamp = new Date().toISOString().slice(0, 10);

        const began = Date.now();
        const project = await client.createProject({
          customerName: "NovaCRM Template Check",
          dueDate: stamp,
          externalReferenceId: `verify-${tier}-${Date.now()}`,
          ownerEmail: ROCKETLANE_OWNER_EMAIL,
          projectName: `${plan.label} template check ${stamp}`,
          startDate: stamp,
          templateId,
        });
        console.log(
          `${plan.label}: project ${project.projectId} built from "${project.templateName}" (${project.templateId}) in ${Date.now() - began} ms`
        );

        expect(project.templateId).toBe(templateId);
        expect(project.templateName).toBe(plan.templateName);

        const outcome = await client.assignPlaceholders(project.projectId, [
          { email: ROCKETLANE_PM_EMAIL, roleName: PROJECT_MANAGER_ROLE },
        ]);
        console.log(`${plan.label}: Project Manager role ->`, outcome);
        expect(outcome.missing).toEqual([]);
      },
      60_000
    );
  }
});
