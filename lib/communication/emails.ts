import type { FieldIssue } from "@/lib/domain/validation";

export interface OutgoingEmail {
  bodyText: string;
  subject: string;
}

const REPLY_PREFIX_RE = /^\s*re:\s*/i;

function replySubject(subject: string): string {
  return `Re: ${subject.replace(REPLY_PREFIX_RE, "").trim()}`;
}

/** Tells the AE exactly what is missing. States plainly that nothing has been started. */
export function buildClarificationEmail(
  issues: FieldIssue[],
  originalSubject: string
): OutgoingEmail {
  const list = issues.map((issue) => `  - ${issue.message}`).join("\n");
  return {
    bodyText: [
      "Hi,",
      "",
      "Thanks for the deal notification. I can't start onboarding yet because of the following:",
      "",
      list,
      "",
      "Please reply to this email with the corrected details and I'll pick it up from there.",
      "No call has been placed, and no project or Slack channel has been created.",
      "",
      "NovaCRM Onboarding Agent",
    ].join("\n"),
    subject: replySubject(originalSubject),
  };
}

export interface CompletionEmailInput {
  channelName: string | null;
  customerName: string;
  dueDate: string;
  planLabel: string;
  projectUrl: string | null;
}

/** Closing the loop with the AE once everything has been created. */
export function buildCompletionEmail(
  input: CompletionEmailInput,
  originalSubject: string
): OutgoingEmail {
  return {
    bodyText: [
      "Hi,",
      "",
      `Onboarding for ${input.customerName} is set up on the ${input.planLabel} plan.`,
      "",
      `  - Rocketlane project: ${input.projectUrl ?? "created (link not available yet)"}`,
      `  - Slack channel: ${input.channelName ? `#${input.channelName}` : "created"}`,
      `  - Target go-live: ${input.dueDate}`,
      "",
      "NovaCRM Onboarding Agent",
    ].join("\n"),
    subject: replySubject(originalSubject),
  };
}
