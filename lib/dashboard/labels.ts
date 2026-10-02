import type {
  AuditAgent,
  AuditOutcome,
  EscalationReason,
} from "@/lib/domain/schemas";
import type { Tone } from "./state-meta";

export const STEP_LABELS: Record<string, string> = {
  claim_opportunity: "Check for a duplicate opportunity",
  complete: "Finish onboarding",
  create_channel: "Create Slack channel",
  assign_project_manager: "Assign Project Manager",
  create_project: "Create Rocketlane project",
  escalate_call: "Escalate the call",
  evaluate_call: "Read the call result",
  invite_customer: "Invite the customer",
  label_processed: "Label the email",
  notify_ae: "Email the AE a summary",
  ops_alert: "Alert the ops channel",
  parse_email: "Extract fields from the email",
  place_call: "Call the AE",
  resolve_escalation: "Mark the escalation handled",
  post_welcome: "Post the welcome message",
  receive_email: "Receive the email",
  unexpected_failure: "Unexpected failure",
  validate_deal: "Validate required fields",
  verify_sender: "Verify the sender",
  voice_webhook: "Call-result webhook",
  workflow_started: "Start the durable workflow",
};

export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

export const REASON_LABELS: Record<EscalationReason, string> = {
  CALL_RETRIES_EXHAUSTED: "AE call: retries exhausted",
  DUPLICATE_PROJECT: "Duplicate project",
  PROCESSING_ERROR: "Unexpected processing error",
  ROCKETLANE_FAILURE: "Rocketlane failed",
  SENDER_NOT_AUTHENTICATED: "Sender failed email authentication",
  SLACK_FAILURE: "Slack setup failed",
  TEMPLATE_MISMATCH: "Wrong or unconfirmed template",
  UNKNOWN_AE: "Unknown sender",
  VOICE_SYSTEM_ERROR: "Voice provider problem",
};

export const AGENT_LABELS: Record<AuditAgent, string> = {
  communication: "Communication agent",
  human: "Human",
  intake: "Intake agent",
  system: "System",
};

export const OUTCOME_TONE: Record<AuditOutcome, Tone> = {
  blocked: "warning",
  escalated: "danger",
  failure: "danger",
  info: "neutral",
  retry: "warning",
  skipped: "neutral",
  success: "success",
};
