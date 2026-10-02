import { z } from "zod";
import {
  type InboundMessage,
  inboundMessageSchema,
  type OutboundReply,
} from "@/lib/domain/schemas";
import { startWorkflowOnce } from "@/lib/pipeline/launch";
import { registerMessage } from "@/lib/pipeline/register";
import { describeError } from "@/lib/pipeline/support";
import type { PipelineDeps } from "@/lib/pipeline/types";

export const MAX_INGEST_BATCH = 25;
const OUTBOX_PAGE_SIZE = 10;
const MAX_ACK_IDS = 50;

export const ingestPayloadSchema = z.object({
  messages: z.array(inboundMessageSchema).min(1).max(MAX_INGEST_BATCH),
});

export const ackPayloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_ACK_IDS),
});

export type IngestStatus =
  | "registered"
  | "duplicate"
  | "escalated"
  | "ignored"
  | "error";

export interface IngestResult {
  error?: string;
  id: string;
  status: IngestStatus;
}

/**
 * Takes the emails the Apps Script found and starts onboarding for each new one. Safe to call
 * repeatedly with the same emails: a message is claimed once, and the workflow is started at
 * most once, even if the script retries after a timeout or two requests overlap. A message
 * that fails comes back as `error` so the script leaves it unlabelled and re-sends it.
 */
export async function handleIngest(
  deps: PipelineDeps,
  messages: InboundMessage[],
  start: (dealId: string) => Promise<string>
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const message of messages) {
    try {
      await deps.store.mail.saveInbound(message);
      const registered = await registerMessage(deps, message.id);
      if (
        registered.status === "registered" ||
        registered.status === "duplicate"
      ) {
        // A duplicate may be a deal whose first workflow start failed, so try again.
        await startWorkflowOnce(deps, message.id, start);
      }
      results.push({ id: message.id, status: registered.status });
    } catch (error) {
      results.push({
        error: describeError(error),
        id: message.id,
        status: "error",
      });
    }
  }
  return results;
}

/** Replies waiting to be sent from the CS inbox. */
export async function listOutbox(deps: PipelineDeps): Promise<OutboundReply[]> {
  return await deps.store.mail.listPendingReplies(OUTBOX_PAGE_SIZE);
}

export async function ackOutbox(
  deps: PipelineDeps,
  ids: string[]
): Promise<void> {
  await deps.store.mail.ackReplies(ids);
}
