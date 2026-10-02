import { z } from "zod";
import { Auditor } from "@/lib/audit";
import { safeEqual } from "@/lib/http/auth";
import { IntegrationError } from "@/lib/integrations/errors";
import { describeError } from "@/lib/pipeline/support";
import type { PipelineDeps } from "@/lib/pipeline/types";

/** Bolna's published webhook source addresses. */
export const BOLNA_WEBHOOK_IPS: readonly string[] = [
  "13.203.39.153",
  "13.126.9.249",
  "13.202.133.53",
];

/** Statuses after which a call's transcript and extraction are final (per Bolna's docs). */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);

/** Only what we need. The body is a nudge to look, never the source of truth. */
export const webhookBodySchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
});

export interface VoiceWebhookRequest {
  body: unknown;
  clientIp: string | null;
  token: string | null;
}

export interface VoiceWebhookConfig {
  ipCheck: "enforce" | "off";
  secret: string | undefined;
}

export interface VoiceWebhookResponse {
  body: { action?: string; error?: string; reason?: string };
  status: number;
}

/** `not_waiting` means no workflow is currently waiting on that hook. */
export type ResumeResult = "resumed" | "not_waiting";
export type ResumeHook = (
  token: string,
  payload: { executionId: string }
) => Promise<ResumeResult>;

function ignored(reason: string): VoiceWebhookResponse {
  return { body: { action: "ignored", reason }, status: 200 };
}

/**
 * Handles a Bolna call-status webhook. Bolna posts several times per call with the same
 * execution ID, and the transcript and extraction are empty until the status is terminal, so:
 *
 *  1. The caller must know the secret in the URL and come from Bolna's addresses. Bolna
 *     offers no signature, so this is the best available proof of origin.
 *  2. Non-terminal statuses are acknowledged and ignored.
 *  3. The body is never trusted. We re-fetch the execution from Bolna with our own API key and
 *     act only if the provider confirms it is terminal.
 *  4. The first confirmed terminal event per execution wakes the workflow; repeats are no-ops.
 *
 * Every non-error outcome returns 200, so Bolna has no reason to keep retrying. If a wake-up
 * is ever lost, the workflow's timeout pulls the result itself.
 */
export async function handleVoiceWebhook(
  deps: PipelineDeps,
  request: VoiceWebhookRequest,
  config: VoiceWebhookConfig,
  resume: ResumeHook
): Promise<VoiceWebhookResponse> {
  if (!config.secret) {
    return { body: { error: "This endpoint is not configured" }, status: 503 };
  }
  if (!(request.token && safeEqual(request.token, config.secret))) {
    return { body: { error: "Unauthorized" }, status: 401 };
  }
  if (
    config.ipCheck === "enforce" &&
    !(request.clientIp && BOLNA_WEBHOOK_IPS.includes(request.clientIp))
  ) {
    return { body: { error: "Forbidden" }, status: 403 };
  }

  const parsed = webhookBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return { body: { error: "Invalid payload" }, status: 400 };
  }
  const { id: executionId, status } = parsed.data;

  if (!TERMINAL_STATUSES.has(status)) {
    return ignored(`status "${status}" is not final`);
  }

  const mapping = await deps.store.deals.getCallExecution(executionId);
  if (!mapping) {
    return ignored("unknown execution");
  }

  let providerStatus: string;
  try {
    const result = await deps.voice.getResult(executionId);
    if (!result.isTerminal) {
      return ignored("the provider reports the call is still in progress");
    }
    providerStatus = result.providerStatus;
  } catch (error) {
    if (error instanceof IntegrationError) {
      return {
        body: {
          error: `Could not verify the call with the provider: ${describeError(error)}`,
        },
        status: 502,
      };
    }
    throw error;
  }

  if (!(await deps.store.deals.claimCallEvent(executionId, "terminal"))) {
    return { body: { action: "duplicate" }, status: 200 };
  }

  const resumed = await resume(mapping.hookToken, { executionId });

  const deal = await deps.store.deals.getDeal(mapping.dealId);
  await new Auditor(
    deps.store.audit,
    { agent: "system", dealId: mapping.dealId, runId: deal?.runId ?? null },
    { clock: deps.clock, newId: deps.newId }
  ).record({
    input: { attempt: mapping.attempt, executionId, webhookStatus: status },
    outcome: "info",
    output: { providerStatus, resumed: resumed === "resumed" },
    rationale:
      resumed === "resumed"
        ? "The voice provider reported the call finished, verified directly with the provider. The workflow was woken to read the result."
        : "The voice provider reported the call finished, but no workflow was waiting on it. The workflow will read the result on its own when it next looks.",
    step: "voice_webhook",
  });

  return { body: { action: resumed }, status: 200 };
}
