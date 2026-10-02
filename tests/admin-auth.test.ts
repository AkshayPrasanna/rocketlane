import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  passwordMatches,
  readCookie,
  SESSION_SECONDS,
  verifySessionToken,
} from "@/lib/admin-auth";

const PASSWORD = "correct horse battery staple";
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

describe("admin password", () => {
  it("accepts the right password and rejects others", async () => {
    expect(await passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(await passwordMatches("wrong", PASSWORD)).toBe(false);
    expect(await passwordMatches("", PASSWORD)).toBe(false);
    expect(await passwordMatches(`${PASSWORD} `, PASSWORD)).toBe(false);
  });
});

describe("admin session token", () => {
  it("verifies a fresh token", async () => {
    const token = await createSessionToken(PASSWORD, NOW);

    expect(await verifySessionToken(token, PASSWORD, NOW + 1000)).toBe(true);
  });

  it("expires after the session length", async () => {
    const token = await createSessionToken(PASSWORD, NOW);

    expect(
      await verifySessionToken(
        token,
        PASSWORD,
        NOW + (SESSION_SECONDS - 5) * 1000
      )
    ).toBe(true);
    expect(
      await verifySessionToken(
        token,
        PASSWORD,
        NOW + (SESSION_SECONDS + 5) * 1000
      )
    ).toBe(false);
  });

  it("rejects a token signed with a different password", async () => {
    const token = await createSessionToken("another password", NOW);

    expect(await verifySessionToken(token, PASSWORD, NOW)).toBe(false);
  });

  it("rejects a token whose expiry was edited to extend it", async () => {
    const token = await createSessionToken(PASSWORD, NOW);
    const [expires, signature] = token.split(".");
    const forged = `${Number(expires) + 100_000}.${signature}`;

    expect(await verifySessionToken(forged, PASSWORD, NOW)).toBe(false);
  });

  it.each([
    undefined,
    null,
    "",
    "garbage",
    "123",
    "abc.def",
    "123.",
  ])("rejects a missing or malformed token: %s", async (token) => {
    expect(await verifySessionToken(token, PASSWORD, NOW)).toBe(false);
  });

  it("rejects everything when no admin password is configured", async () => {
    const token = await createSessionToken(PASSWORD, NOW);

    expect(await verifySessionToken(token, undefined, NOW)).toBe(false);
    expect(await verifySessionToken(token, "", NOW)).toBe(false);
  });
});

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(
      readCookie("a=1; onboarding_admin=abc.def; b=2", "onboarding_admin")
    ).toBe("abc.def");
  });

  it("keeps equals signs inside a value", () => {
    expect(readCookie("x=a=b=c", "x")).toBe("a=b=c");
  });

  it("returns undefined when absent", () => {
    expect(readCookie("a=1", "missing")).toBeUndefined();
    expect(readCookie(null, "missing")).toBeUndefined();
  });
});
