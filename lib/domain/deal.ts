import type { DealRecord } from "./schemas";

export interface NewDealInput {
  aeEmail: string | null;
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string | null;
}

/** The record created the moment an email is claimed; everything else is filled in later. */
export function newDeal(input: NewDealInput, now: Date): DealRecord {
  const timestamp = now.toISOString();
  return {
    aeEmail: input.aeEmail,
    callAttempts: 0,
    channel: null,
    createdAt: timestamp,
    dealId: input.gmailMessageId,
    gmailMessageId: input.gmailMessageId,
    gmailThreadId: input.gmailThreadId,
    missingFields: [],
    parsed: null,
    planTier: null,
    project: null,
    projectRequestedAt: null,
    runId: null,
    state: "RECEIVED",
    stateReason: "Email received",
    subject: input.subject,
    updatedAt: timestamp,
  };
}
