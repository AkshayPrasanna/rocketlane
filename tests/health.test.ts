import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "0123456789abcdef0123456789abcdef";

/** Loads the route fresh, because the environment and dependencies are cached per process. */
async function callHealth(env: Record<string, string>, secret: string | null) {
  vi.resetModules();
  vi.stubEnv("GMAIL_BRIDGE_SECRET", SECRET);
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  const { GET } = await import("@/app/api/health/route");
  const headers = secret ? { "x-bridge-secret": secret } : undefined;
  const response = await GET(
    new Request("https://app.test/api/health", { headers })
  );
  return { body: await response.json(), status: response.status };
}

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses callers without the bridge secret", async () => {
    const { status } = await callHealth({}, null);

    expect(status).toBe(401);
  });

  it("reports ok when the configuration builds", async () => {
    const { body, status } = await callHealth({}, SECRET);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.modes.rocketlane).toBe("mock");
  });

  it("names the missing variable when live Rocketlane is half configured", async () => {
    const { body, status } = await callHealth(
      {
        ROCKETLANE_API_KEY: "rl-test-key",
        ROCKETLANE_MODE: "live",
        ROCKETLANE_OWNER_EMAIL: "owner@novacrm.io",
        ROCKETLANE_TEMPLATE_ID_ENTERPRISE: "101",
        ROCKETLANE_TEMPLATE_ID_GROWTH: "102",
      },
      SECRET
    );

    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.problem).toContain("ROCKETLANE_PM_EMAIL");
  });

  it("never echoes a secret value in the problem it reports", async () => {
    const { body } = await callHealth(
      { ROCKETLANE_API_KEY: "rl-super-secret-key", ROCKETLANE_MODE: "live" },
      SECRET
    );

    expect(JSON.stringify(body)).not.toContain("rl-super-secret-key");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
