import { z } from "zod";
import { dealStateSchema } from "./states";

export const planTierSchema = z.enum(["enterprise", "growth"]);
export type PlanTier = z.infer<typeof planTierSchema>;

const isoTimestamp = z.iso.datetime();

/** Why the model believes a field has the value it extracted; shown in the audit log. */
export const fieldEvidenceSchema = z.object({
  confidence: z.number().min(0).max(1),
  quote: z.string().nullable(),
});
export type FieldEvidence = z.infer<typeof fieldEvidenceSchema>;

/**
 * What the email parser extracted. Required fields are nullable on purpose: the parser
 * must report "not found" rather than guess, and validation decides what that means.
 * `aeEmail` comes from the sender header, never from the (untrusted) body.
 */
export const parsedDealSchema = z.object({
  aeEmail: z.string(),
  aeName: z.string().nullable(),
  customerContactEmail: z.string().nullable(),
  customerContactName: z.string().nullable(),
  customerName: z.string().nullable(),
  evidence: z.record(z.string(), fieldEvidenceSchema).default({}),
  notes: z.string().nullable(),
  opportunityId: z.string().nullable(),
  salesforceOpportunityUrl: z.string().nullable(),
});
export type ParsedDeal = z.infer<typeof parsedDealSchema>;

export const projectRefSchema = z.object({
  dueDate: z.string(),
  projectId: z.string(),
  projectUrl: z.string().nullable(),
  startDate: z.string(),
  templateId: z.string(),
  templateName: z.string(),
});
export type ProjectRef = z.infer<typeof projectRefSchema>;

export const channelRefSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  channelUrl: z.string().nullable(),
  /** Set once the welcome message is posted, so a retried step never posts it twice. */
  welcomePostedAt: isoTimestamp.nullable(),
});
export type ChannelRef = z.infer<typeof channelRefSchema>;

export const dealRecordSchema = z.object({
  aeEmail: z.string().nullable(),
  callAttempts: z.number().int().min(0),
  channel: channelRefSchema.nullable(),
  createdAt: isoTimestamp,
  /** Equal to the Gmail message ID, which is the idempotency key for the whole flow. */
  dealId: z.string().min(1),
  gmailMessageId: z.string().min(1),
  gmailThreadId: z.string().nullable(),
  missingFields: z.array(z.string()),
  parsed: parsedDealSchema.nullable(),
  planTier: planTierSchema.nullable(),
  project: projectRefSchema.nullable(),
  /** Set just before the Rocketlane create call; lets a retry recognise its own project. */
  projectRequestedAt: isoTimestamp.nullable(),
  runId: z.string().nullable(),
  state: dealStateSchema,
  /** Human-readable reason for the most recent state change. */
  stateReason: z.string().nullable(),
  subject: z.string().nullable(),
  updatedAt: isoTimestamp,
});
export type DealRecord = z.infer<typeof dealRecordSchema>;

/** Fields a caller may change without a state transition. */
export type DealPatch = Partial<
  Omit<
    DealRecord,
    "createdAt" | "dealId" | "gmailMessageId" | "state" | "updatedAt"
  >
>;

export const ESCALATION_REASONS = [
  "UNKNOWN_AE",
  "PROCESSING_ERROR",
  "CALL_RETRIES_EXHAUSTED",
  "VOICE_SYSTEM_ERROR",
  "DUPLICATE_PROJECT",
  "ROCKETLANE_FAILURE",
  "SLACK_FAILURE",
] as const;
export const escalationReasonSchema = z.enum(ESCALATION_REASONS);
export type EscalationReason = z.infer<typeof escalationReasonSchema>;

export const escalationSchema = z.object({
  createdAt: isoTimestamp,
  dealId: z.string(),
  detail: z.string(),
  id: z.string(),
  opsNotified: z.boolean(),
  reason: escalationReasonSchema,
  resolvedAt: isoTimestamp.nullable(),
  resolvedBy: z.string().nullable(),
});
export type Escalation = z.infer<typeof escalationSchema>;

export const AUDIT_AGENTS = [
  "intake",
  "communication",
  "system",
  "human",
] as const;
export const AUDIT_OUTCOMES = [
  "success",
  "failure",
  "blocked",
  "retry",
  "escalated",
  "skipped",
  "info",
] as const;

export const auditEntrySchema = z.object({
  agent: z.enum(AUDIT_AGENTS),
  dealId: z.string().nullable(),
  id: z.string(),
  input: z.json(),
  outcome: z.enum(AUDIT_OUTCOMES),
  output: z.json(),
  rationale: z.string().min(1),
  runId: z.string().nullable(),
  step: z.string().min(1),
  timestamp: isoTimestamp,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditAgent = AuditEntry["agent"];
export type AuditOutcome = AuditEntry["outcome"];

/** Links a Bolna execution back to the deal and workflow hook waiting on it. */
export const callExecutionSchema = z.object({
  attempt: z.number().int().min(1),
  dealId: z.string(),
  executionId: z.string(),
  hookToken: z.string(),
});
export type CallExecutionMapping = z.infer<typeof callExecutionSchema>;
