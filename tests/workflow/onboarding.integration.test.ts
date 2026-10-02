import { waitForHook } from "@workflow/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { resumeHook, start } from "workflow/api";
import type { CallScript } from "@/lib/integrations/voice/mock";
import { onboardingWorkflow } from "@/workflows/onboarding";
import { createHarness, type Harness } from "../helpers/harness";
import { useStepsFor } from "../helpers/workflow-steps";

const CONFIRM_ENTERPRISE: CallScript = {
  kind: "confirmed",
  tier: "enterprise",
};
const NO_ANSWER: CallScript = { kind: "terminal", outcome: "no_answer" };

/** Real sleeps, kept short so the suite stays fast. */
const FAST_TIMERS = {
  CALL_RESULT_TIMEOUT_SECONDS: "2",
  CALL_RETRY_DELAY_SECONDS: "1",
  RETRY_BASE_DELAY_SECONDS: "1",
};

let h: Harness;

function useHarness(voice: CallScript[]) {
  h = createHarness({ env: FAST_TIMERS, voice });
  useStepsFor(h.deps);
}

/** Registers the email, then starts the real durable workflow for it. */
async function startWorkflow() {
  const { messageId } = await h.receive();
  const run = await start(onboardingWorkflow, [{ dealId: messageId }]);
  return { messageId, run };
}

/** What the Bolna webhook route does: wake the hook for this attempt. */
async function signalCall(messageId: string, attempt: number) {
  await resumeHook(`call:${messageId}:${attempt}`, {
    executionId: `exec-${attempt}`,
  });
}

afterEach(() => {
  useStepsFor(null);
});

describe("onboarding workflow on the real Workflow runtime", () => {
  it("completes when the call-result webhook wakes the hook", async () => {
    useHarness([CONFIRM_ENTERPRISE]);
    const { messageId, run } = await startWorkflow();

    await waitForHook(run, { token: `call:${messageId}:1` });
    await signalCall(messageId, 1);

    expect(await run.returnValue).toBe("COMPLETE");
    expect((await h.deal(messageId)).state).toBe("COMPLETE");
    expect(h.voice.placed).toHaveLength(1);
    expect(h.rocketlane.createRequests).toHaveLength(1);
    expect(h.slack.channels.size).toBe(1);
  });

  it("falls back to pulling the result when the webhook never arrives", async () => {
    useHarness([CONFIRM_ENTERPRISE]);
    const { run } = await startWorkflow();

    // No webhook is sent: the race against the timer ends the wait, and the evaluate step
    // pulls the call result from the provider directly.
    expect(await run.returnValue).toBe("COMPLETE");
    expect(h.voice.resultLookups).toBeGreaterThanOrEqual(1);
  });

  it("retries after a durable sleep with a fresh hook for each attempt", async () => {
    useHarness([NO_ANSWER, CONFIRM_ENTERPRISE]);
    const { messageId, run } = await startWorkflow();

    await waitForHook(run, { token: `call:${messageId}:1` });
    await signalCall(messageId, 1);
    // Attempt 1 ends unanswered, the workflow sleeps, then opens a new hook for attempt 2.
    await waitForHook(run, { token: `call:${messageId}:2` });
    await signalCall(messageId, 2);

    expect(await run.returnValue).toBe("COMPLETE");
    expect(h.voice.placed).toHaveLength(2);
    expect((await h.deal(messageId)).callAttempts).toBe(2);
  });

  it("escalates after the final unanswered call", async () => {
    useHarness([NO_ANSWER, NO_ANSWER, NO_ANSWER]);
    const { messageId, run } = await startWorkflow();

    for (const attempt of [1, 2, 3]) {
      await waitForHook(run, { token: `call:${messageId}:${attempt}` });
      await signalCall(messageId, attempt);
    }

    expect(await run.returnValue).toBe("ESCALATED_TO_HUMAN");
    expect((await h.deal(messageId)).state).toBe("ESCALATED_TO_HUMAN");
    expect(h.rocketlane.createRequests).toHaveLength(0);
    expect(
      await h.store.deals.listEscalations({ openOnly: true })
    ).toHaveLength(1);
  });

  it("backs off with a durable sleep when Rocketlane fails, then succeeds", async () => {
    useHarness([CONFIRM_ENTERPRISE]);
    h.rocketlane.faults.arm("createProject", {
      kind: "server_error",
      times: 2,
    });
    const { messageId, run } = await startWorkflow();

    await waitForHook(run, { token: `call:${messageId}:1` });
    await signalCall(messageId, 1);

    expect(await run.returnValue).toBe("COMPLETE");
    expect(h.rocketlane.projects).toHaveLength(1);
  });

  it("stops at a clarification request without ever opening a call hook", async () => {
    useHarness([]);
    const { messageId } = await h.receive({
      bodyText: "Customer: Acme Corp\nAE: Ravi Kumar",
      subject: "Deal closed",
    });
    const run = await start(onboardingWorkflow, [{ dealId: messageId }]);

    expect(await run.returnValue).toBe("NEEDS_CLARIFICATION");
    expect(h.voice.placed).toHaveLength(0);
    expect(h.gmail.replies).toHaveLength(1);
  });
});
