import { createAeDirectory } from "@/config/ae-directory";
import { parseEnv } from "@/lib/env";
import type { EmailParser } from "@/lib/intake/parser";
import { MockGmailClient } from "@/lib/integrations/gmail/mock";
import { MockRocketlaneClient } from "@/lib/integrations/rocketlane/mock";
import { MockSlackClient } from "@/lib/integrations/slack/mock";
import {
  type CallScript,
  MockVoiceProvider,
} from "@/lib/integrations/voice/mock";
import { runOnboarding } from "@/lib/pipeline/orchestrator";
import { registerMessage } from "@/lib/pipeline/register";
import { buildSettings } from "@/lib/pipeline/settings";
import { createOnboardingSteps } from "@/lib/pipeline/steps";
import type {
  CallWaiter,
  PipelineDeps,
  PipelineRuntime,
} from "@/lib/pipeline/types";
import { createMemoryStore } from "@/lib/store/get-store";
import type { Store } from "@/lib/store/types";
import { AE, dealEmail } from "./emails";
import { FakeParser } from "./fake-parser";

export const OPS_CHANNEL = "C-OPS";
export const FIXED_NOW = new Date("2026-10-02T10:00:00.000Z");
export const WORKFLOW_RUN_ID = "wf-run-test";

export interface HarnessOptions {
  directory?: ReturnType<typeof createAeDirectory>;
  env?: Record<string, string>;
  parser?: EmailParser;
  /** Use a specific store, e.g. Upstash for a live seed. Defaults to a fresh in-memory store. */
  store?: Store;
  voice?: CallScript[];
  /** When true, the call-result webhook never arrives and every wait times out. */
  waitTimesOut?: boolean;
}

export function createHarness(options: HarnessOptions = {}) {
  const store = options.store ?? createMemoryStore(() => FIXED_NOW);
  const gmail = new MockGmailClient();
  const voice = new MockVoiceProvider(options.voice ?? []);
  const rocketlane = new MockRocketlaneClient();
  const slack = new MockSlackClient();
  const fakeParser = new FakeParser();
  const parser = options.parser ?? fakeParser;

  let idCounter = 0;
  const deps: PipelineDeps = {
    clock: () => FIXED_NOW,
    directory: options.directory ?? createAeDirectory([AE]),
    gmail,
    newId: () => `id-${++idCounter}`,
    parser,
    rocketlane,
    settings: buildSettings(
      parseEnv({
        CALL_RETRY_DELAY_SECONDS: "20",
        MAX_CALL_ATTEMPTS: "3",
        OPS_SLACK_CHANNEL_ID: OPS_CHANNEL,
        RETRY_BASE_DELAY_SECONDS: "5",
        RETRY_MAX_ATTEMPTS: "4",
        ...options.env,
      })
    ),
    slack,
    store,
    voice,
  };

  // Rocketlane reports a template's name, so the mock knows what each plan's template is called.
  for (const plan of Object.values(deps.settings.plans)) {
    rocketlane.templateNames.set(plan.templateId, plan.templateName);
  }

  const sleeps: number[] = [];
  const waitersOpened: Array<{ attempt: number; hookToken: string }> = [];
  const runtime: PipelineRuntime = {
    openCallWaiter(args): CallWaiter {
      waitersOpened.push({ attempt: args.attempt, hookToken: args.hookToken });
      return {
        dispose() {
          /* nothing to release in tests */
        },
        wait: () =>
          Promise.resolve({ timedOut: options.waitTimesOut ?? false }),
      };
    },
    sleep(seconds) {
      sleeps.push(seconds);
      return Promise.resolve();
    },
  };

  const steps = createOnboardingSteps(deps);

  /** An email arrives from the AE and is registered, but the workflow has not run yet. */
  async function receive(
    email: { bodyText: string; subject: string } = dealEmail(),
    fromEmail: string = AE.email
  ) {
    const messageId = gmail.deliver({
      bodyText: email.bodyText,
      fromEmail,
      fromName: AE.name,
      subject: email.subject,
    });
    const registered = await registerMessage(deps, messageId);
    return { messageId, registered };
  }

  /** The full path: email arrives, is registered, and the workflow runs to completion. */
  async function run(
    email: { bodyText: string; subject: string } = dealEmail(),
    fromEmail: string = AE.email
  ) {
    const { messageId, registered } = await receive(email, fromEmail);
    if (registered.status !== "registered") {
      return { messageId, outcome: null, registered };
    }
    const outcome = await runOnboarding(
      { dealId: messageId, workflowRunId: WORKFLOW_RUN_ID },
      steps,
      runtime
    );
    return { messageId, outcome, registered };
  }

  return {
    deps,
    gmail,
    /** How many times the default fake parser was invoked (0 if a custom parser was supplied). */
    parseCalls: () => fakeParser.calls.length,
    parser,
    receive,
    rocketlane,
    run,
    runtime,
    sleeps,
    slack,
    steps,
    store,
    voice,
    waitersOpened,
    /** Convenience lookups for assertions. */
    async deal(dealId: string) {
      const deal = await store.deals.getDeal(dealId);
      if (!deal) {
        throw new Error(`Deal ${dealId} not found`);
      }
      return deal;
    },
    async auditSteps(dealId: string) {
      return (await store.audit.listByDeal(dealId)).map((e) => e.step);
    },
  };
}

export type Harness = ReturnType<typeof createHarness>;
