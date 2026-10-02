import { Auditor } from "@/lib/audit";
import { newDeal } from "@/lib/domain/deal";
import { describeError, escalate } from "./support";
import type { PipelineDeps, RegisterResult } from "./types";

/**
 * The entry point for every inbound email, whether it arrived by Pub/Sub push or by the
 * poll fallback. It is safe to call any number of times for the same message: only the
 * first call creates a deal, so redelivery or re-polling can never cause a second call,
 * project or channel.
 *
 * Unknown senders are stopped here, before the email reaches the model, so an outsider
 * can neither get a reply nor feed text to the parser.
 */
export async function registerMessage(
  deps: PipelineDeps,
  messageId: string
): Promise<RegisterResult> {
  const message = await deps.gmail.getMessage(messageId);
  const systemAuditor = (runId: string | null) =>
    new Auditor(
      deps.store.audit,
      { agent: "system", dealId: message.id, runId },
      { clock: deps.clock, newId: deps.newId }
    );

  if (message.generatedByAgent) {
    return { reason: "Message was sent by this agent", status: "ignored" };
  }

  const claimed = await deps.store.deals.claimMessage(message.id, message.id);
  if (!claimed) {
    const existing = await deps.store.deals.getDeal(message.id);
    await systemAuditor(existing?.runId ?? null).record({
      input: { messageId: message.id },
      outcome: "skipped",
      output: { action: "none" },
      rationale:
        "This Gmail message was already claimed. Redelivery is ignored so no second call, project or channel can be created.",
      step: "receive_email",
    });
    return { dealId: message.id, status: "duplicate" };
  }

  // One correlation ID ties every audit entry for this email together, from receipt on.
  const runId = deps.newId();
  const system = systemAuditor(runId);
  await deps.store.deals.createDeal({
    ...newDeal(
      {
        aeEmail: message.from.email,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        subject: message.subject,
      },
      deps.clock()
    ),
    runId,
  });
  await system.record({
    input: {
      from: message.from.email,
      messageId: message.id,
      subject: message.subject,
    },
    outcome: "success",
    output: { state: "RECEIVED" },
    rationale:
      "New email claimed. The Gmail message ID is the idempotency key for the whole flow.",
    step: "receive_email",
  });

  try {
    await deps.gmail.addLabel(message.id, deps.settings.gmailProcessedLabel);
  } catch (error) {
    await system.record({
      input: { label: deps.settings.gmailProcessedLabel },
      outcome: "failure",
      output: { error: describeError(error) },
      rationale:
        "Could not label the message as processed. Harmless: the claim, not the label, prevents reprocessing.",
      step: "label_processed",
    });
  }

  const ae = deps.directory.lookup(message.from.email);
  if (!ae) {
    await escalate(deps, {
      agent: "intake",
      dealId: message.id,
      detail: `Sender ${message.from.email} is not in the AE directory. The email was not read by the model, no reply was sent and no one was called.`,
      input: { sender: message.from.email },
      rationale:
        "Only known AEs may start onboarding, and we never call a number that isn't in the directory.",
      reason: "UNKNOWN_AE",
      step: "verify_sender",
      toState: "ESCALATED_TO_HUMAN",
    });
    return { dealId: message.id, status: "escalated" };
  }

  return { dealId: message.id, status: "registered" };
}
