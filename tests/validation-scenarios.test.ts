import { describe, expect, it } from "vitest";
import { AE, dealEmail, OPPORTUNITY_URL } from "./helpers/emails";
import { StubParser } from "./helpers/fake-parser";
import { createHarness } from "./helpers/harness";

interface Case {
  email: { bodyText: string; subject: string };
  expectedFields: string[];
  name: string;
}

const CASES: Case[] = [
  {
    email: dealEmail({ customer: null }),
    expectedFields: ["customerName"],
    name: "missing customer name",
  },
  {
    email: dealEmail({ contactEmail: null }),
    expectedFields: ["customerContactEmail"],
    name: "missing contact email",
  },
  {
    email: dealEmail({ contactEmail: "jane.doe@" }),
    expectedFields: ["customerContactEmail"],
    name: "malformed contact email",
  },
  {
    email: dealEmail({ aeName: null }),
    expectedFields: ["aeName"],
    name: "missing AE name",
  },
  {
    email: dealEmail({ opportunityUrl: null }),
    expectedFields: ["salesforceOpportunityUrl"],
    name: "missing opportunity link",
  },
  {
    email: dealEmail({ opportunityUrl: "https://example.com/deals/42" }),
    expectedFields: ["salesforceOpportunityUrl"],
    name: "a link that is not Salesforce",
  },
  {
    email: dealEmail({
      opportunityUrl: "https://novacrm.lightning.force.com/lightning/page/home",
    }),
    expectedFields: ["salesforceOpportunityUrl"],
    name: "a Salesforce link with no opportunity ID",
  },
  {
    email: dealEmail({
      opportunityUrl: "http://novacrm.my.salesforce.com/006Ux000001AbCdIAK",
    }),
    expectedFields: ["salesforceOpportunityUrl"],
    name: "a non-https Salesforce link",
  },
  {
    email: { bodyText: "", subject: "" },
    expectedFields: [
      "customerName",
      "customerContactEmail",
      "aeName",
      "salesforceOpportunityUrl",
    ],
    name: "an empty email",
  },
  {
    email: {
      bodyText: "asdf qwer zxcv 12345 !!!! lorem ipsum dolor sit amet",
      subject: "hello",
    },
    expectedFields: [
      "customerName",
      "customerContactEmail",
      "aeName",
      "salesforceOpportunityUrl",
    ],
    name: "garbage input",
  },
  {
    email: dealEmail({ customer: null, contactEmail: null, aeName: null }),
    expectedFields: ["customerName", "customerContactEmail", "aeName"],
    name: "several missing fields at once",
  },
];

describe("validation: incomplete or malformed emails ask for clarification", () => {
  it.each(CASES)("$name", async ({ email, expectedFields }) => {
    const h = createHarness({ voice: [] });

    const { messageId, outcome } = await h.run(email);

    expect(outcome).toBe("NEEDS_CLARIFICATION");
    const deal = await h.deal(messageId);
    expect(deal.state).toBe("NEEDS_CLARIFICATION");
    expect(deal.missingFields).toEqual(expectedFields);

    // Nothing downstream may have happened.
    expect(h.voice.placed).toHaveLength(0);
    expect(h.rocketlane.createRequests).toHaveLength(0);
    expect(h.rocketlane.projects).toHaveLength(0);
    expect(h.slack.channels.size).toBe(0);
    expect(await h.store.deals.listEscalations()).toEqual([]);

    // The AE was told exactly what is wrong, in the original thread.
    expect(h.gmail.replies).toHaveLength(1);
    const [reply] = h.gmail.replies;
    expect(reply.to).toBe(AE.email);
    expect(reply.threadId).toBe(`thread-${messageId}`);
    expect(reply.subject.startsWith("Re: ")).toBe(true);
    expect(reply.bodyText).toContain("No call has been placed");
    const lines = reply.bodyText
      .split("\n")
      .filter((l) => l.startsWith("  - "));
    expect(lines).toHaveLength(expectedFields.length);
  });

  it("names each missing field in plain language", async () => {
    const h = createHarness();

    await h.run(dealEmail({ customer: null, opportunityUrl: null }));

    const body = h.gmail.replies[0].bodyText;
    expect(body).toContain("Customer name is missing");
    expect(body).toContain("Salesforce opportunity link is missing");
    expect(body).not.toContain("AE name");
  });

  it("treats a value the model invented as missing", async () => {
    const h = createHarness({
      parser: new StubParser({
        aeName: "Ravi Kumar",
        customerContactEmail: "ceo@bigcorp.com",
        customerName: "BigCorp",
        salesforceOpportunityUrl: OPPORTUNITY_URL,
      }),
      voice: [],
    });

    const { messageId, outcome } = await h.run(
      dealEmail({ contactEmail: null, customer: "Acme Corp" })
    );

    expect(outcome).toBe("NEEDS_CLARIFICATION");
    expect((await h.deal(messageId)).missingFields).toEqual([
      "customerName",
      "customerContactEmail",
    ]);
    expect(h.voice.placed).toHaveLength(0);
  });

  it("records why in the audit log", async () => {
    const h = createHarness();

    const { messageId } = await h.run(dealEmail({ contactEmail: null }));

    const entries = await h.store.audit.listByDeal(messageId);
    const validate = entries.find((e) => e.step === "validate_deal");
    expect(validate?.outcome).toBe("blocked");
    expect(validate?.rationale).toContain("instead of guessing");
    expect(JSON.stringify(validate?.output)).toContain("customerContactEmail");
  });

  it("accepts a plus-addressed contact email and a classic Salesforce URL", async () => {
    const h = createHarness({ voice: [{ kind: "confirmed", tier: "growth" }] });

    const { outcome } = await h.run(
      dealEmail({
        contactEmail: "jane+nova@acme.co.uk",
        opportunityUrl: "https://na123.salesforce.com/006Ux000001AbCd",
      })
    );

    expect(outcome).toBe("COMPLETE");
  });
});
