import { describe, expect, it } from "vitest";
import { exportFilename, toJsonl } from "@/lib/audit-export";
import { auditEntrySchema } from "@/lib/domain/schemas";
import { createHarness } from "./helpers/harness";

describe("audit export", () => {
  it("writes one valid JSON object per line, oldest first", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });
    await h.run();
    const entries = await h.store.audit.listAll();

    const lines = toJsonl(entries).trimEnd().split("\n");

    expect(lines).toHaveLength(entries.length);
    const parsed = lines.map((line) =>
      auditEntrySchema.parse(JSON.parse(line))
    );
    expect(parsed.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    const times = parsed.map((e) => e.timestamp);
    expect([...times].sort()).toEqual(times);
  });

  it("ends with a newline so the file concatenates cleanly", async () => {
    const h = createHarness();
    await h.run();

    expect(toJsonl(await h.store.audit.listAll()).endsWith("\n")).toBe(true);
  });

  it("exports nothing as an empty file", () => {
    expect(toJsonl([])).toBe("");
  });

  it("never contains a raw email address or phone number", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });
    await h.run();

    const text = toJsonl(await h.store.audit.listAll());

    expect(text).not.toContain("jane.doe@acme.com");
    expect(text).not.toContain("ravi.kumar@novacrm.io");
    expect(text).not.toContain("+15555550100");
  });

  it("names the file by deal and date", () => {
    const day = new Date("2026-10-02T10:00:00Z");

    expect(exportFilename(null, day)).toBe("audit-2026-10-02.jsonl");
    expect(exportFilename("msg-1", day)).toBe("audit-msg-1-2026-10-02.jsonl");
  });
});
