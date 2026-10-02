import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlackText } from "@/components/slack-text";
import { buildWelcomeMessage, escapeSlack } from "@/lib/communication/messages";

const render = (text: string) =>
  renderToStaticMarkup(createElement(SlackText, { text }));

describe("rendering Slack messages in the dashboard", () => {
  it("renders bold, code and links", () => {
    const html = render("*Hi* `x` <https://acme.test/p|Open project>");

    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("<code");
    expect(html).toContain('href="https://acme.test/p"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Open project</a>");
  });

  it("never lets message text become HTML", () => {
    const html = render(
      "<script>alert(1)</script> <img src=x onerror=alert(1)>"
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only turns http(s) links into anchors", () => {
    const html = render("<javascript:alert(1)|click me>");

    expect(html).not.toContain("<a ");
  });

  it("shows text the agent escaped for Slack as the original characters", () => {
    const html = render(escapeSlack("Tom & Jerry <Co>"));

    expect(html).toContain("Tom &amp; Jerry &lt;Co&gt;");
  });

  it("renders a full welcome message with its bullets and link", () => {
    const text = buildWelcomeMessage({
      aeName: "Ravi",
      customerContactName: null,
      customerName: "Acme",
      dealId: "m1",
      plan: {
        csm: { defaultName: "Arjun", kind: "dedicated" },
        csmName: "Arjun",
        durationDays: 30,
        label: "Enterprise",
        phases: [{ endDay: 30, name: "Go-Live", startDay: 0 }],
        templateId: "1",
        templateName: "T",
        tier: "enterprise",
      },
      projectUrl: "https://acme.test/p",
      schedule: {
        dueDate: "2026-11-01",
        phases: [
          { endDate: "2026-11-01", name: "Go-Live", startDate: "2026-10-02" },
        ],
        startDate: "2026-10-02",
      },
    });

    const html = render(text);

    expect(html).toContain("<strong>Acme</strong>");
    expect(html).toContain("Open your onboarding project");
  });
});
