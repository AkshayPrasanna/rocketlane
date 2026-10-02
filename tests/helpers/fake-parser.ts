import type { ParsedDeal } from "@/lib/domain/schemas";
import type { EmailParser, ParserInput } from "@/lib/intake/parser";

function grab(body: string, label: string): string | null {
  const match = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(body);
  return match?.[1]?.trim() ?? null;
}

/**
 * Stands in for the LLM. It pulls "Label: value" lines out of the body, returns null for
 * anything it can't find, and, like the real parser, has no notion of a plan tier at all.
 */
export class FakeParser implements EmailParser {
  readonly calls: ParserInput[] = [];

  parse(input: ParserInput): Promise<ParsedDeal> {
    this.calls.push(input);
    const body = input.bodyText;
    return Promise.resolve({
      aeEmail: input.senderEmail,
      aeName: grab(body, "AE"),
      customerContactEmail: grab(body, "Contact email"),
      customerContactName: grab(body, "Contact name"),
      customerName: grab(body, "Customer"),
      evidence: {},
      notes: grab(body, "Notes"),
      opportunityId: null,
      salesforceOpportunityUrl: grab(body, "Opportunity"),
    });
  }
}

/** Returns whatever it is told to, e.g. to simulate a model that hallucinated a field. */
export class StubParser implements EmailParser {
  private readonly result: Partial<ParsedDeal>;

  constructor(result: Partial<ParsedDeal>) {
    this.result = result;
  }

  parse(input: ParserInput): Promise<ParsedDeal> {
    return Promise.resolve({
      aeEmail: input.senderEmail,
      aeName: null,
      customerContactEmail: null,
      customerContactName: null,
      customerName: null,
      evidence: {},
      notes: null,
      opportunityId: null,
      salesforceOpportunityUrl: null,
      ...this.result,
    });
  }
}
