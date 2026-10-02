import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("defaults every integration to mock and uses safe call settings", () => {
    const env = parseEnv({});

    expect(env.modes).toEqual({
      gmail: "mock",
      rocketlane: "mock",
      slack: "mock",
      voice: "mock",
    });
    expect(env.call).toEqual({
      maxAttempts: 3,
      resultTimeoutSeconds: 600,
      retryDelaySeconds: 900,
    });
    expect(env.redis).toBeNull();
  });

  it("ignores whitespace pasted around a value, such as a shared secret", () => {
    const env = parseEnv({ GMAIL_BRIDGE_SECRET: "  0123456789abcdef0123\n" });

    expect(env.secrets.gmailBridge).toBe("0123456789abcdef0123");
  });

  it("switches a single integration to live without touching the others", () => {
    const env = parseEnv({ ROCKETLANE_MODE: "live" });

    expect(env.modes.rocketlane).toBe("live");
    expect(env.modes.voice).toBe("mock");
  });

  it("rejects an unknown mode", () => {
    expect(() => parseEnv({ VOICE_MODE: "sandbox" })).toThrow("VOICE_MODE");
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ AE_DEMO_PHONE: "", MAX_CALL_ATTEMPTS: " " });

    expect(env.ae.demoPhone).toBeUndefined();
    expect(env.call.maxAttempts).toBe(3);
  });

  it("requires the demo AE phone to be E.164", () => {
    expect(() => parseEnv({ AE_DEMO_PHONE: "98765 43210" })).toThrow(
      "AE_DEMO_PHONE"
    );
    expect(parseEnv({ AE_DEMO_PHONE: "+919876543210" }).ae.demoPhone).toBe(
      "+919876543210"
    );
  });

  it("bounds call attempts so a typo cannot cause a dial storm", () => {
    expect(() => parseEnv({ MAX_CALL_ATTEMPTS: "0" })).toThrow("MAX_CALL");
    expect(() => parseEnv({ MAX_CALL_ATTEMPTS: "50" })).toThrow("MAX_CALL");
  });

  it("accepts either Upstash or Vercel KV credential names", () => {
    const upstash = parseEnv({
      UPSTASH_REDIS_REST_TOKEN: "t1",
      UPSTASH_REDIS_REST_URL: "https://a.upstash.io",
    });
    const kv = parseEnv({
      KV_REST_API_TOKEN: "t2",
      KV_REST_API_URL: "https://b.upstash.io",
    });

    expect(upstash.redis).toEqual({ token: "t1", url: "https://a.upstash.io" });
    expect(kv.redis).toEqual({ token: "t2", url: "https://b.upstash.io" });
  });

  it("ignores a half-configured Redis pair", () => {
    expect(
      parseEnv({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io" }).redis
    ).toBeNull();
  });
});
