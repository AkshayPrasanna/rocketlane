import { describe, expect, it } from "vitest";
import { checkSharedSecret, safeEqual } from "@/lib/http/auth";

const SECRET = "0123456789abcdef0123";

describe("shared secret check", () => {
  it("accepts the right secret", () => {
    expect(checkSharedSecret(SECRET, SECRET)).toBeNull();
  });

  it("rejects a wrong, missing or empty secret with 401", () => {
    expect(checkSharedSecret("wrong", SECRET)).toEqual({
      error: "Unauthorized",
      status: 401,
    });
    expect(checkSharedSecret(null, SECRET)?.status).toBe(401);
    expect(checkSharedSecret("", SECRET)?.status).toBe(401);
  });

  it("fails closed with 503 when the server has no secret configured", () => {
    expect(checkSharedSecret(SECRET, undefined)?.status).toBe(503);
    expect(checkSharedSecret("", undefined)?.status).toBe(503);
  });

  it("compares secrets of different lengths without throwing", () => {
    expect(safeEqual("short", SECRET)).toBe(false);
    expect(safeEqual(SECRET, SECRET)).toBe(true);
  });

  it("is case sensitive", () => {
    expect(safeEqual(SECRET.toUpperCase(), SECRET)).toBe(false);
  });
});
