import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { createIntegrations } from "@/lib/integrations/factory";
import { buildSettings } from "@/lib/pipeline/settings";
import { createMemoryStore } from "@/lib/store/get-store";

/** The demo configuration: everything real except Slack. */
const LIVE = {
  GMAIL_MODE: "live",
  ROCKETLANE_MODE: "live",
  SLACK_MODE: "mock",
  VOICE_MODE: "live",
} as const;

const HTTPS_URL = /^https:\/\//;
const PROJECT_URL_PATTERN = /^https:\/\/[^/]+\/projects\/\{id\}$/;

/**
 * Checks that the environment you are about to deploy is complete and consistent when every
 * integration except Slack runs live. Offline, and it never prints a value:
 *
 *   pnpm test:live tests/live/env.live.test.ts
 *
 * Reads .env.local. On Vercel, the same variable names must be set there.
 */
describe("the live demo environment", () => {
  const env = parseEnv({ ...process.env, ...LIVE });

  it("is valid and consistent", () => {
    const settings = buildSettings(env);

    expect(settings.plans.enterprise.templateId).not.toBe(
      settings.plans.growth.templateId
    );
    expect(settings.rocketlaneOwnerEmail).not.toBe("owner@mock.test");
    expect(settings.rocketlanePmEmail).not.toBe("pm@mock.test");
  });

  it("builds every live client", () => {
    const integrations = createIntegrations(
      env,
      createMemoryStore(() => new Date()),
      { clock: () => new Date(), newId: () => "id" }
    );

    expect(Object.keys(integrations).sort()).toEqual([
      "gmail",
      "rocketlane",
      "slack",
      "voice",
    ]);
  });

  it("has the shared secrets the inbound routes need", () => {
    expect(env.secrets.adminPassword).toBeTruthy();
    expect(env.secrets.bolnaWebhook).toBeTruthy();
    expect(env.secrets.gmailBridge).toBeTruthy();
  });

  it("has a Redis store and the demo AE", () => {
    expect(env.redis).not.toBeNull();
    expect(env.ae.demoEmail).toBeTruthy();
    expect(env.ae.demoName).toBeTruthy();
    expect(env.ae.demoPhone).toBeTruthy();
  });

  it("points the app URL and Rocketlane links at real addresses", () => {
    expect(env.appUrl).toMatch(HTTPS_URL);
    expect(env.rocketlane.projectUrlTemplate).toMatch(PROJECT_URL_PATTERN);
  });
});
