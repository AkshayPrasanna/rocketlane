import { describe, expect, it } from "vitest";
import {
  AUDIT_AGENTS,
  AUDIT_OUTCOMES,
  auditEntrySchema,
} from "@/lib/domain/schemas";
import type { CallScript } from "@/lib/integrations/voice/mock";
import { AE, dealEmail } from "./helpers/emails";
import { createHarness, type Harness } from "./helpers/harness";

const CONTRADICTION_OR_HEDGE_RE = /both plans|hedged/;
const NO_ANSWER: CallScript = { kind: "terminal", outcome: "no_answer" };

interface Scenario {
  email?: { bodyText: string; subject: string };
  from?: string;
  name: string;
  setup?: (h: Harness) => void;
  voice: CallScript[];
}

const SCENARIOS: Scenario[] = [
  { name: "happy path", voice: [{ kind: "confirmed", tier: "enterprise" }] },
  {
    email: dealEmail({ customer: null }),
    name: "missing field",
    voice: [],
  },
  { name: "no answer", voice: [NO_ANSWER, NO_ANSWER, NO_ANSWER] },
  {
    name: "ambiguous answer",
    voice: Array.from({ length: 3 }, () => ({
      aeSays: ["Probably Enterprise?"],
      extracted: { confirmed: false, planTier: "enterprise" as const },
      kind: "spoken" as const,
    })),
  },
  {
    name: "provider out of credit",
    voice: [{ kind: "terminal", outcome: "system_error" }],
  },
  {
    name: "Rocketlane down",
    setup: (h) => h.rocketlane.faults.armDown("createProject"),
    voice: [{ kind: "confirmed", tier: "growth" }],
  },
  {
    name: "existing project",
    setup: (h) => h.rocketlane.seed({ projectName: "Acme Corp - Old" }),
    voice: [{ kind: "confirmed", tier: "growth" }],
  },
  { from: "stranger@evil.example", name: "unknown sender", voice: [] },
];

describe("audit log completeness", () => {
  it.each(
    SCENARIOS
  )("$name: every entry has all required fields", async (scenario) => {
    const h = createHarness({ voice: scenario.voice });
    scenario.setup?.(h);

    const { messageId } = await h.run(scenario.email, scenario.from);

    const entries = await h.store.audit.listByDeal(messageId);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of entries) {
      // Parsing proves the shape; the checks below prove the content is meaningful.
      expect(auditEntrySchema.parse(entry)).toEqual(entry);
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      expect(entry.runId).toBeTruthy();
      expect(entry.dealId).toBe(messageId);
      expect(AUDIT_AGENTS).toContain(entry.agent);
      expect(AUDIT_OUTCOMES).toContain(entry.outcome);
      expect(entry.step.length).toBeGreaterThan(0);
      expect(entry.rationale.length).toBeGreaterThan(10);
      expect(entry).toHaveProperty("input");
      expect(entry).toHaveProperty("output");
    }
  });

  it.each(
    SCENARIOS
  )("$name: one run ID ties the whole deal together", async (scenario) => {
    const h = createHarness({ voice: scenario.voice });
    scenario.setup?.(h);

    const { messageId } = await h.run(scenario.email, scenario.from);

    const runIds = new Set(
      (await h.store.audit.listByDeal(messageId)).map((e) => e.runId)
    );
    expect(runIds.size).toBe(1);
  });

  it.each(
    SCENARIOS
  )("$name: entries are in chronological order", async (scenario) => {
    const h = createHarness({ voice: scenario.voice });
    scenario.setup?.(h);

    const { messageId } = await h.run(scenario.email, scenario.from);

    const times = (await h.store.audit.listByDeal(messageId)).map(
      (e) => e.timestamp
    );
    expect([...times].sort()).toEqual(times);
  });

  it("masks the AE's phone number and everyone's email address", async () => {
    const h = createHarness({
      voice: [{ kind: "confirmed", tier: "enterprise" }],
    });

    await h.run();

    const dump = JSON.stringify(await h.store.audit.listAll());
    expect(dump).not.toContain(AE.phone);
    expect(dump).not.toContain(AE.email);
    expect(dump).not.toContain("jane.doe@acme.com");
    // Names and non-personal identifiers stay readable for debugging.
    expect(dump).toContain("Acme Corp");
    expect(dump).toContain(AE.name);
  });

  it("explains each call attempt's decision in plain language", async () => {
    const h = createHarness({
      voice: [
        NO_ANSWER,
        {
          aeSays: ["Enterprise. Actually, I think Growth."],
          extracted: { confirmed: true, planTier: "enterprise" },
          kind: "spoken",
        },
        { kind: "confirmed", tier: "growth" },
      ],
    });

    const { messageId } = await h.run();

    const evaluations = (await h.store.audit.listByDeal(messageId)).filter(
      (e) => e.step === "evaluate_call"
    );
    expect(evaluations.map((e) => e.outcome)).toEqual([
      "retry",
      "retry",
      "success",
    ]);
    expect(evaluations[0].rationale).toContain("no-answer");
    expect(evaluations[1].rationale).toMatch(CONTRADICTION_OR_HEDGE_RE);
    expect(evaluations[2].rationale).toContain("without contradiction");
  });
});
