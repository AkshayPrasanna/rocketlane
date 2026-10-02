import type { ParsedDeal } from "@/lib/domain/schemas";

export interface ParserInput {
  bodyText: string;
  /** From the Gmail header. Authoritative; the parser must not take identity from the body. */
  senderEmail: string;
  senderName: string | null;
  subject: string;
}

/**
 * Turns a messy deal-notification email into structured fields. This is the only place an
 * LLM is used. The email is untrusted data: it can supply field values, but nothing the
 * parser returns can set the plan tier, change configuration or trigger an action.
 */
export interface EmailParser {
  parse(input: ParserInput): Promise<ParsedDeal>;
}
