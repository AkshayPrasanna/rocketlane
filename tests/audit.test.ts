import { describe, expect, it } from "vitest";
import { Auditor } from "@/lib/audit";
import { auditEntrySchema } from "@/lib/domain/schemas";
import { createMemoryStore } from "@/lib/store/get-store";

const NOW = new Date("2026-10-02T10:00:00.000Z");

function setup() {
  const store = createMemoryStore();
  let counter = 0;
  const auditor = new Auditor(
    store.audit,
    { agent: "intake", dealId: "m1", runId: "run-1" },
    { clock: () => NOW, newId: () => `id-${++counter}` }
  );
  return { auditor, store };
}

describe("Auditor", () => {
  it("writes every required field", async () => {
    const { auditor, store } = setup();

    await auditor.record({
      input: { messageId: "m1" },
      outcome: "success",
      output: { state: "PARSED" },
      rationale: "All required fields present",
      step: "parse_email",
    });

    const [entry] = await store.audit.listByDeal("m1");
    expect(auditEntrySchema.parse(entry)).toEqual({
      agent: "intake",
      dealId: "m1",
      id: "id-1",
      input: { messageId: "m1" },
      outcome: "success",
      output: { state: "PARSED" },
      rationale: "All required fields present",
      runId: "run-1",
      step: "parse_email",
      timestamp: "2026-10-02T10:00:00.000Z",
    });
  });

  it("masks emails and phone numbers before storing", async () => {
    const { auditor, store } = setup();

    await auditor.record({
      input: { to: "ae@novacrm.io", phone: "+919876543210" },
      outcome: "info",
      rationale: "Placing call",
      step: "place_call",
    });

    const [entry] = await store.audit.listAll();
    expect(JSON.stringify(entry)).not.toContain("ae@novacrm.io");
    expect(JSON.stringify(entry)).not.toContain("9876543210");
  });

  it("stores missing input and output as null rather than dropping them", async () => {
    const { auditor, store } = setup();

    await auditor.record({
      outcome: "info",
      rationale: "Workflow started",
      step: "start",
    });

    const [entry] = await store.audit.listAll();
    expect(entry.input).toBeNull();
    expect(entry.output).toBeNull();
  });

  it("switches agent attribution without losing the deal or run", async () => {
    const { auditor, store } = setup();

    await auditor.with({ agent: "communication" }).record({
      outcome: "success",
      rationale: "Channel created",
      step: "create_channel",
    });

    const [entry] = await store.audit.listAll();
    expect(entry.agent).toBe("communication");
    expect(entry.dealId).toBe("m1");
    expect(entry.runId).toBe("run-1");
  });

  it("indexes entries per deal and keeps dealless entries in the global log", async () => {
    const { auditor, store } = setup();
    await auditor.record({ outcome: "info", rationale: "a", step: "one" });
    await auditor
      .with({ dealId: null, agent: "system" })
      .record({ outcome: "info", rationale: "b", step: "renew_watch" });
    await auditor.with({ dealId: "m2" }).record({
      outcome: "info",
      rationale: "c",
      step: "other",
    });

    expect(await store.audit.listByDeal("m1")).toHaveLength(1);
    expect(await store.audit.listAll()).toHaveLength(3);
    expect((await store.audit.listRecent(2)).map((e) => e.step)).toEqual([
      "renew_watch",
      "other",
    ]);
  });

  it("refuses an entry with no rationale", async () => {
    const { auditor } = setup();

    await expect(
      auditor.record({ outcome: "info", rationale: "", step: "x" })
    ).rejects.toThrow();
  });
});
