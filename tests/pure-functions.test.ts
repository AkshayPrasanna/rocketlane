import { describe, expect, it } from "vitest";
import { buildDemoAeDirectory, createAeDirectory } from "@/config/ae-directory";
import { ONBOARDING_PLANS, resolvePlan } from "@/config/onboarding-plans";
import { buildClarificationEmail } from "@/lib/communication/emails";
import {
  buildChannelPurpose,
  buildChannelTopic,
  buildOpsAlert,
  buildWelcomeMessage,
  type ChannelContentInput,
  escapeSlack,
} from "@/lib/communication/messages";
import {
  buildChannelName,
  isValidChannelName,
  slugify,
} from "@/lib/domain/channel-name";
import {
  addDays,
  computeSchedule,
  formatShortDate,
  todayIn,
} from "@/lib/domain/schedule";
import { extractOpportunityId } from "@/lib/domain/validation";

const PLAN_OVERRIDES = {
  csmNames: {},
  templateIds: { enterprise: "101", growth: "102" },
};

function content(tier: "enterprise" | "growth"): ChannelContentInput {
  const plan = resolvePlan(tier, PLAN_OVERRIDES);
  return {
    aeName: "Ravi Kumar",
    customerContactName: "Jane Doe",
    customerName: "Acme Corp",
    dealId: "msg-1",
    plan,
    projectUrl: "https://acme.rocketlane.com/projects/7",
    schedule: computeSchedule(plan, "2026-10-02"),
  };
}

describe("schedule", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-02", 30)).toBe("2026-11-01");
    expect(addDays("2026-12-20", 14)).toBe("2027-01-03");
    expect(addDays("2028-02-20", 10)).toBe("2028-03-01");
  });

  it("rejects a malformed date", () => {
    expect(() => addDays("10/02/2026", 1)).toThrow("YYYY-MM-DD");
  });

  it("computes start, due date and four phase windows from the plan", () => {
    const enterprise = computeSchedule(
      ONBOARDING_PLANS.enterprise,
      "2026-10-02"
    );
    const growth = computeSchedule(ONBOARDING_PLANS.growth, "2026-10-02");

    expect(enterprise.dueDate).toBe("2026-11-01");
    expect(growth.dueDate).toBe("2026-10-16");
    expect(enterprise.phases.at(-1)?.endDate).toBe(enterprise.dueDate);
    expect(growth.phases.at(-1)?.endDate).toBe(growth.dueDate);
    expect(enterprise.phases[0]).toEqual({
      endDate: "2026-10-05",
      name: "Kickoff",
      startDate: "2026-10-02",
    });
  });

  it("uses the calendar date in the given time zone, not UTC", () => {
    const lateUtc = new Date("2026-10-02T20:00:00Z");

    expect(todayIn(lateUtc, "UTC")).toBe("2026-10-02");
    expect(todayIn(lateUtc, "Asia/Kolkata")).toBe("2026-10-03");
    expect(todayIn(lateUtc, "America/Los_Angeles")).toBe("2026-10-02");
  });

  it("formats short dates", () => {
    expect(formatShortDate("2026-11-01")).toBe("1 Nov");
    expect(formatShortDate("2026-10-16")).toBe("16 Oct");
  });
});

describe("channel names", () => {
  it("builds onb-<customer>-<tier>", () => {
    expect(buildChannelName("Acme Corp", "enterprise")).toBe(
      "onb-acme-corp-enterprise"
    );
    expect(buildChannelName("Acme Corp", "growth")).toBe(
      "onb-acme-corp-growth"
    );
  });

  it("strips punctuation and accents", () => {
    expect(slugify("Café Münch, Inc.")).toBe("cafe-munch-inc");
    expect(slugify("  --Acme__Corp!! ")).toBe("acme-corp");
  });

  it("falls back for names with no Latin characters", () => {
    expect(slugify("株式会社")).toBe("customer");
    expect(buildChannelName("株式会社", "growth")).toBe("onb-customer-growth");
  });

  it("never exceeds Slack's limit and always keeps the tier and suffix", () => {
    const name = buildChannelName("A".repeat(300), "enterprise", 12);

    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("-enterprise-12")).toBe(true);
    expect(isValidChannelName(name)).toBe(true);
  });

  it("only adds a suffix after the first collision", () => {
    expect(buildChannelName("Acme", "growth", 1)).toBe("onb-acme-growth");
    expect(buildChannelName("Acme", "growth", 2)).toBe("onb-acme-growth-2");
  });

  it("validates Slack's naming rules", () => {
    expect(isValidChannelName("onb-acme-growth")).toBe(true);
    expect(isValidChannelName("Onb-Acme")).toBe(false);
    expect(isValidChannelName("onb acme")).toBe(false);
    expect(isValidChannelName("")).toBe(false);
  });
});

describe("Salesforce opportunity IDs", () => {
  it.each([
    [
      "https://x.lightning.force.com/lightning/r/Opportunity/006Ux000001AbCdIAK/view",
      "006Ux000001AbCdIAK",
    ],
    ["https://na1.salesforce.com/006Ux000001AbCd", "006Ux000001AbCd"],
    [
      "https://x.my.salesforce.com/lightning/r/006Ux000001AbCdIAK/view?foo=1",
      "006Ux000001AbCdIAK",
    ],
  ])("extracts the ID from %s", (url, id) => {
    expect(extractOpportunityId(new URL(url))).toBe(id);
  });

  it.each([
    "https://x.lightning.force.com/lightning/page/home",
    "https://x.lightning.force.com/lightning/r/Account/001Ux000001AbCdIAK/view",
    "https://x.lightning.force.com/lightning/r/Opportunity/006short/view",
  ])("finds no opportunity ID in %s", (url) => {
    expect(extractOpportunityId(new URL(url))).toBeNull();
  });
});

describe("Slack content", () => {
  it("escapes the characters Slack treats as syntax", () => {
    expect(escapeSlack("<!channel> & <@U123>")).toBe(
      "&lt;!channel&gt; &amp; &lt;@U123&gt;"
    );
  });

  it("describes the Enterprise plan: 30 days, dedicated CSM, four phases with dates", () => {
    const text = buildWelcomeMessage(content("enterprise"));

    expect(text).toContain("*Enterprise* plan");
    expect(text).toContain("*30-day* onboarding");
    expect(text).toContain("*dedicated CSM, Arjun Mehta*");
    expect(text).toContain("• *Kickoff*: 2 Oct to 5 Oct");
    expect(text).toContain("• *Data Migration*: 6 Oct to 16 Oct");
    expect(text).toContain("• *Configuration*: 17 Oct to 26 Oct");
    expect(text).toContain("• *Go-Live*: 27 Oct to 1 Nov");
    expect(text).toContain(
      "<https://acme.rocketlane.com/projects/7|Open your onboarding project>"
    );
    expect(text).toContain("will propose times for your kickoff call");
  });

  it("describes the Growth plan: 14 days, pooled CSM, compressed dates", () => {
    const text = buildWelcomeMessage(content("growth"));

    expect(text).toContain("*Growth* plan");
    expect(text).toContain("*14-day* onboarding");
    expect(text).toContain("*pooled CSM team (NovaCRM Growth CS Pod)*");
    expect(text).toContain("compressed to fit 14 days");
    expect(text).toContain("• *Kickoff*: 2 Oct to 3 Oct");
    expect(text).toContain("• *Go-Live*: 13 Oct to 16 Oct");
    expect(text).not.toContain("dedicated");
    expect(text).toContain("two or three times that work for you");
  });

  it("says the project is on its way when there is no link yet", () => {
    const text = buildWelcomeMessage({
      ...content("growth"),
      projectUrl: null,
    });

    expect(text).toContain("being set up");
    expect(text).not.toContain("<http");
  });

  it("refuses to embed a link that could break out of Slack's link syntax", () => {
    const text = buildWelcomeMessage({
      ...content("growth"),
      projectUrl: "https://x.test/a|b>c",
    });

    expect(text).not.toContain("a|b");
  });

  it("builds a topic within Slack's 250 character limit", () => {
    const topic = buildChannelTopic({
      ...content("enterprise"),
      customerName: "Very Long Customer Name ".repeat(30),
    });

    expect(topic.length).toBeLessThanOrEqual(250);
    expect(buildChannelTopic(content("enterprise"))).toBe(
      "Acme Corp onboarding · Enterprise plan (30 days) · Dedicated CSM: Arjun Mehta · Go-live target 1 Nov"
    );
  });

  it("marks the purpose with the deal so retries can recognise the channel", () => {
    expect(buildChannelPurpose(content("growth"))).toContain("[deal:msg-1]");
  });

  it("builds an ops alert that names the customer, reason and deal", () => {
    const text = buildOpsAlert({
      appUrl: "https://onboarding.example.com",
      customerName: "Acme Corp",
      dealId: "msg-9",
      detail: "AE did not answer",
      reason: "CALL_RETRIES_EXHAUSTED",
      state: "ESCALATED_TO_HUMAN",
    });

    expect(text).toContain("Acme Corp");
    expect(text).toContain("CALL_RETRIES_EXHAUSTED");
    expect(text).toContain("`msg-9`");
    expect(text).toContain(
      "<https://onboarding.example.com/|Open the escalation queue>"
    );
  });
});

describe("clarification email", () => {
  it("lists each issue and says nothing was started", () => {
    const email = buildClarificationEmail(
      [
        {
          field: "customerName",
          message: "Customer name is missing",
          reason: "missing",
        },
        { field: "aeName", message: "AE name is missing", reason: "missing" },
      ],
      "Re: Deal closed: Acme"
    );

    expect(email.subject).toBe("Re: Deal closed: Acme");
    expect(email.bodyText).toContain("  - Customer name is missing");
    expect(email.bodyText).toContain("  - AE name is missing");
    expect(email.bodyText).toContain(
      "no project or Slack channel has been created"
    );
  });
});

describe("AE directory", () => {
  it("looks AEs up by email, ignoring case and whitespace", () => {
    const directory = createAeDirectory([
      { email: "Ravi@novacrm.io", name: "Ravi", phone: "+15555550100" },
    ]);

    expect(directory.lookup(" ravi@NOVACRM.io ")?.name).toBe("Ravi");
    expect(directory.lookup("other@novacrm.io")).toBeNull();
    expect(directory.lookup(null)).toBeNull();
  });

  it("builds the demo directory only when email, name and phone are all supplied", () => {
    const full = buildDemoAeDirectory({
      demoEmail: "ae@example.com",
      demoName: "Demo AE",
      demoPhone: "+15555550100",
    });
    const noPhone = buildDemoAeDirectory({
      demoEmail: "ae@example.com",
      demoName: "Demo AE",
      demoPhone: undefined,
    });

    expect(full.lookup("ae@example.com")?.phone).toBe("+15555550100");
    expect(noPhone.lookup("ae@example.com")).toBeNull();
  });
});
