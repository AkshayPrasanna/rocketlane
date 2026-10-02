import { z } from "zod";
import type { ParsedDeal } from "./schemas";

export type RequiredField =
  | "customerName"
  | "customerContactEmail"
  | "aeName"
  | "salesforceOpportunityUrl";

export type IssueReason = "missing" | "malformed" | "not_in_email";

export interface FieldIssue {
  field: RequiredField;
  /** Plain-language explanation, safe to send back to the AE. Never echoes the raw value. */
  message: string;
  reason: IssueReason;
}

/** Everything the pipeline needs, with every required field present and checked. */
export interface ValidatedDeal {
  aeEmail: string;
  aeName: string;
  customerContactEmail: string;
  customerContactName: string | null;
  customerName: string;
  notes: string | null;
  opportunityId: string;
  salesforceOpportunityUrl: string;
}

export type ValidationResult =
  | { deal: ValidatedDeal; ok: true }
  | { issues: FieldIssue[]; ok: false };

/** The raw email the parser read. Used to prove the model didn't invent a value. */
export interface EmailSource {
  bodyText: string;
  senderName: string | null;
  subject: string;
}

export const FIELD_LABELS: Record<RequiredField, string> = {
  aeName: "AE name",
  customerContactEmail: "Customer contact email",
  customerName: "Customer name",
  salesforceOpportunityUrl: "Salesforce opportunity link",
};

type Checked<T> = { issue: FieldIssue } | { value: T };

const SALESFORCE_HOST_RE = /(^|\.)(salesforce\.com|force\.com)$/i;
// Standard Opportunity IDs start with the key prefix 006 and are 15 or 18 characters.
const OPPORTUNITY_ID_RE =
  /(?:^|[/=?&])(006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?=$|[/?&#])/;
const TOKEN_SPLIT_RE = /[^\p{L}\p{N}]+/u;
const TRAILING_PUNCTUATION_RE = /[)>\],.;:'"]+$/;
const PLACEHOLDER_RE = /^(tbd|tba|n\/?a|none|null|unknown|xxx+|-+|\?+)$/i;
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;
const WHITESPACE_RE = /\s+/g;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;
const emailSchema = z.email();

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter((token) => token.length > 0);
}

/** True when every word of `value` appears in the source, in any order. */
function wordsAppearIn(value: string, haystack: Set<string>): boolean {
  const words = tokens(value);
  return words.length > 0 && words.every((word) => haystack.has(word));
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim().replace(WHITESPACE_RE, " ") ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function missing(field: RequiredField): { issue: FieldIssue } {
  return {
    issue: {
      field,
      message: `${FIELD_LABELS[field]} is missing`,
      reason: "missing",
    },
  };
}

function problem(
  field: RequiredField,
  reason: IssueReason,
  detail: string
): { issue: FieldIssue } {
  return {
    issue: {
      field,
      message: `${FIELD_LABELS[field]} ${detail}`,
      reason,
    },
  };
}

function checkName(
  field: "customerName" | "aeName",
  value: string | null,
  sourceWords: Set<string>
): Checked<string> {
  const name = cleanText(value);
  if (!name) {
    return missing(field);
  }
  const looksReal =
    name.length >= MIN_NAME_LENGTH &&
    name.length <= MAX_NAME_LENGTH &&
    !PLACEHOLDER_RE.test(name) &&
    LETTER_OR_DIGIT_RE.test(name);
  if (!looksReal) {
    return problem(field, "malformed", "doesn't look like a real name");
  }
  if (!wordsAppearIn(name, sourceWords)) {
    return problem(field, "not_in_email", "could not be found in the email");
  }
  return { value: name };
}

function checkContactEmail(
  value: string | null,
  sourceText: string
): Checked<string> {
  const field = "customerContactEmail";
  const email = cleanText(value);
  if (!email) {
    return missing(field);
  }
  if (!emailSchema.safeParse(email).success) {
    return problem(field, "malformed", "is not a valid email address");
  }
  if (!sourceText.includes(email.toLowerCase())) {
    return problem(field, "not_in_email", "could not be found in the email");
  }
  return { value: email };
}

/** Extracts the opportunity ID from the URL itself; the model's guess is never trusted. */
export function extractOpportunityId(url: URL): string | null {
  return OPPORTUNITY_ID_RE.exec(`${url.pathname}${url.search}`)?.[1] ?? null;
}

function checkSalesforceUrl(
  value: string | null,
  sourceText: string
): Checked<{ opportunityId: string; url: string }> {
  const field = "salesforceOpportunityUrl";
  const raw = cleanText(value)?.replace(TRAILING_PUNCTUATION_RE, "");
  if (!raw) {
    return missing(field);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return problem(field, "malformed", "is not a valid URL");
  }
  if (url.protocol !== "https:" || !SALESFORCE_HOST_RE.test(url.hostname)) {
    return problem(
      field,
      "malformed",
      "is not a Salesforce link (expected an https salesforce.com or force.com URL)"
    );
  }
  if (!sourceText.includes(raw.toLowerCase())) {
    return problem(field, "not_in_email", "could not be found in the email");
  }
  const opportunityId = extractOpportunityId(url);
  if (!opportunityId) {
    return problem(
      field,
      "malformed",
      "does not contain an opportunity ID (it should include 006…)"
    );
  }
  return { value: { opportunityId, url: raw } };
}

/**
 * Deterministic gate between "the model extracted something" and "the pipeline acts on it".
 * Required fields must be present, well-formed and literally traceable to the email text,
 * so a hallucinated or injected value is treated the same as a missing one.
 */
export function validateParsedDeal(
  parsed: ParsedDeal,
  source: EmailSource
): ValidationResult {
  const sourceText = `${source.subject}\n${source.bodyText}`.toLowerCase();
  const sourceWords = new Set(
    tokens(`${source.subject} ${source.bodyText} ${source.senderName ?? ""}`)
  );

  const customerName = checkName(
    "customerName",
    parsed.customerName,
    sourceWords
  );
  const contactEmail = checkContactEmail(
    parsed.customerContactEmail,
    sourceText
  );
  const aeName = checkName("aeName", parsed.aeName, sourceWords);
  const salesforce = checkSalesforceUrl(
    parsed.salesforceOpportunityUrl,
    sourceText
  );

  if (
    "value" in customerName &&
    "value" in contactEmail &&
    "value" in aeName &&
    "value" in salesforce
  ) {
    return {
      deal: {
        aeEmail: parsed.aeEmail,
        aeName: aeName.value,
        customerContactEmail: contactEmail.value,
        customerContactName: cleanText(parsed.customerContactName),
        customerName: customerName.value,
        notes: cleanText(parsed.notes),
        opportunityId: salesforce.value.opportunityId,
        salesforceOpportunityUrl: salesforce.value.url,
      },
      ok: true,
    };
  }

  const issues = [customerName, contactEmail, aeName, salesforce].flatMap(
    (checked) => ("issue" in checked ? [checked.issue] : [])
  );
  return { issues, ok: false };
}
