import { buildClarificationEmail } from "@/lib/communication/emails";
import type { DealRecord, ParsedDeal } from "@/lib/domain/schemas";
import { validateParsedDeal } from "@/lib/domain/validation";
import { auditorFor, escalate, requireDeal } from "./support";
import type { ParseStepResult, PipelineDeps } from "./types";

const ESCALATION_DETAIL_LIMIT = 500;

/** The fields worth showing in the audit log. Emails are masked by the Auditor. */
function summarizeParsed(parsed: ParsedDeal) {
  return {
    aeName: parsed.aeName,
    customerContactEmail: parsed.customerContactEmail,
    customerName: parsed.customerName,
    evidence: parsed.evidence,
    salesforceOpportunityUrl: parsed.salesforceOpportunityUrl,
  };
}

/** Where a re-run of this step should pick up, based on how far the deal already got. */
function resumeResult(deal: DealRecord): ParseStepResult | null {
  switch (deal.state) {
    case "RECEIVED":
    case "PARSED":
      return null;
    case "NEEDS_CLARIFICATION":
      return { missing: deal.missingFields, status: "needs_clarification" };
    case "DUPLICATE_BLOCKED":
      return { status: "duplicate_opportunity" };
    case "ESCALATED_TO_HUMAN":
      return { status: "escalated" };
    default:
      return { status: "validated" };
  }
}

export async function begin(
  deps: PipelineDeps,
  dealId: string,
  workflowRunId: string
): Promise<void> {
  const deal = await requireDeal(deps, dealId);
  await auditorFor(deps, deal, "system").record({
    input: { dealId },
    outcome: "info",
    output: { workflowRunId },
    rationale: "Durable onboarding workflow started for this deal.",
    step: "workflow_started",
  });
}

export async function parseAndValidate(
  deps: PipelineDeps,
  dealId: string
): Promise<ParseStepResult> {
  const deal = await requireDeal(deps, dealId);
  const resumed = resumeResult(deal);
  if (resumed) {
    return resumed;
  }

  const auditor = auditorFor(deps, deal, "intake");
  const message = await deps.gmail.getMessage(deal.gmailMessageId);

  let parsed = deal.parsed;
  if (deal.state === "RECEIVED") {
    const extracted = await deps.parser.parse({
      bodyText: message.bodyText,
      senderEmail: message.from.email,
      senderName: message.from.name,
      subject: message.subject,
    });
    // The sender header is the only trusted identity; whatever the model returned is overwritten.
    parsed = { ...extracted, aeEmail: message.from.email };
    await deps.store.deals.transitionDeal(dealId, "PARSED", {
      parsed,
      stateReason: "Fields extracted from the email",
    });
    await auditor.record({
      input: {
        bodyCharacters: message.bodyText.length,
        from: message.from.email,
        subject: message.subject,
      },
      outcome: "success",
      output: { fields: summarizeParsed(parsed) },
      rationale:
        "The model extracted structured fields with per-field evidence. The email is untrusted data: it has no way to set the plan tier or trigger any action.",
      step: "parse_email",
    });
  }
  if (!parsed) {
    throw new Error(`Deal ${dealId} is PARSED but has no parsed fields`);
  }

  const validation = validateParsedDeal(parsed, {
    bodyText: message.bodyText,
    senderName: message.from.name,
    subject: message.subject,
  });

  if (!validation.ok) {
    const reply = buildClarificationEmail(validation.issues, message.subject);
    await deps.gmail.replyInThread({
      bodyText: reply.bodyText,
      inReplyTo: message.rfc822MessageId,
      messageId: message.id,
      subject: reply.subject,
      threadId: message.threadId,
      to: message.from.email,
    });
    const missing = validation.issues.map((issue) => issue.field);
    await deps.store.deals.transitionDeal(dealId, "NEEDS_CLARIFICATION", {
      missingFields: missing,
      stateReason: validation.issues.map((issue) => issue.message).join("; "),
    });
    await auditor.record({
      input: { fieldsChecked: 4 },
      outcome: "blocked",
      output: { issues: validation.issues, repliedTo: message.from.email },
      rationale:
        "Required fields were missing or malformed. Asked the AE to clarify instead of guessing. No call, project or channel was created.",
      step: "validate_deal",
    });
    return { missing, status: "needs_clarification" };
  }

  const valid = validation.deal;
  const claim = await deps.store.deals.claimOpportunity(
    valid.opportunityId,
    dealId
  );
  if (!claim.claimed) {
    await escalate(deps, {
      agent: "intake",
      dealId,
      detail: `Opportunity ${valid.opportunityId} is already being handled by deal ${claim.existingDealId}. No call or project was created for this email.`,
      input: { opportunityId: valid.opportunityId },
      rationale:
        "A second notification for the same Salesforce opportunity must not start a second onboarding.",
      reason: "DUPLICATE_PROJECT",
      step: "claim_opportunity",
      toState: "DUPLICATE_BLOCKED",
    });
    return { status: "duplicate_opportunity" };
  }

  await deps.store.deals.transitionDeal(dealId, "VALIDATED", {
    missingFields: [],
    parsed: {
      ...parsed,
      aeName: valid.aeName,
      customerContactEmail: valid.customerContactEmail,
      customerContactName: valid.customerContactName,
      customerName: valid.customerName,
      notes: valid.notes,
      opportunityId: valid.opportunityId,
      salesforceOpportunityUrl: valid.salesforceOpportunityUrl,
    },
    stateReason: "All required fields present and verified against the email",
  });
  await auditor.record({
    input: { fieldsChecked: 4 },
    outcome: "success",
    output: {
      customerName: valid.customerName,
      opportunityId: valid.opportunityId,
    },
    rationale:
      "Customer name, contact email, AE name and Salesforce link are all present, well-formed and found in the email text.",
    step: "validate_deal",
  });
  return { status: "validated" };
}

export async function escalateUnexpected(
  deps: PipelineDeps,
  dealId: string,
  message: string
): Promise<void> {
  const deal = await requireDeal(deps, dealId);
  const stopped = new Set([
    "COMPLETE",
    "ESCALATED_TO_HUMAN",
    "DUPLICATE_BLOCKED",
    "ROCKETLANE_FAILED",
  ]);
  if (stopped.has(deal.state)) {
    return;
  }
  const detail = `Unexpected failure in state ${deal.state}: ${message}`.slice(
    0,
    ESCALATION_DETAIL_LIMIT
  );
  await escalate(deps, {
    agent: "system",
    dealId,
    detail,
    rationale:
      "An unexpected error survived the step's automatic retries. Stopping and handing the deal to a human is safer than guessing.",
    reason: "PROCESSING_ERROR",
    step: "unexpected_failure",
    toState: "ESCALATED_TO_HUMAN",
  });
}
