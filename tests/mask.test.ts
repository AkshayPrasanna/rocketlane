import { describe, expect, it } from "vitest";
import { maskDeep, maskEmail, maskPhone, maskText } from "@/lib/domain/mask";

describe("PII masking", () => {
  it("masks the local part of an email but keeps the domain", () => {
    expect(maskEmail("jane.doe@acme.com")).toBe("j***@acme.com");
  });

  it("masks the middle of a phone number", () => {
    expect(maskPhone("+919876543210")).toBe("+91*******210");
  });

  it("finds emails and phones inside free text", () => {
    const masked = maskText("Reach jane@acme.com or +1 415 555 0134 today");

    expect(masked).not.toContain("jane@");
    expect(masked).not.toContain("415 555");
    expect(masked).toContain("@acme.com");
  });

  it("masks deeply nested JSON and leaves other values alone", () => {
    const masked = maskDeep({
      aeName: "Ravi Kumar",
      attempts: 2,
      nested: [{ email: "sam@novacrm.io" }],
    });

    expect(masked).toEqual({
      aeName: "Ravi Kumar",
      attempts: 2,
      nested: [{ email: "s***@novacrm.io" }],
    });
  });

  it("turns undefined into null so entries stay valid JSON", () => {
    expect(maskDeep({ a: undefined })).toEqual({ a: null });
  });

  it("truncates very long strings", () => {
    const masked = maskText("x".repeat(5000));

    expect(masked.length).toBeLessThan(2100);
    expect(masked).toContain("truncated");
  });
});
