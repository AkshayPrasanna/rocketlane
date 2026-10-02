import type { ResolvedPlan } from "@/config/onboarding-plans";
import { formatShortDate, type Schedule } from "@/lib/domain/schedule";

const MAX_TOPIC_LENGTH = 250;
const CONTROL_CHARS_RE = /\p{Cc}+/gu;
const AMPERSAND_RE = /&/g;
const LESS_THAN_RE = /</g;
const GREATER_THAN_RE = />/g;
const LINK_BREAKOUT_RE = /[<>|\s]/;

export interface ChannelContentInput {
  aeName: string;
  customerContactName: string | null;
  customerName: string;
  dealId: string;
  plan: ResolvedPlan;
  projectUrl: string | null;
  schedule: Schedule;
}

/**
 * Escapes the three characters Slack treats as control syntax. Customer and AE names come
 * from an email, so without this a name like "<!channel>" would ping the whole workspace.
 */
export function escapeSlack(text: string): string {
  return text
    .replace(CONTROL_CHARS_RE, " ")
    .replace(AMPERSAND_RE, "&amp;")
    .replace(LESS_THAN_RE, "&lt;")
    .replace(GREATER_THAN_RE, "&gt;");
}

function plainText(text: string): string {
  return text.replace(CONTROL_CHARS_RE, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function csmPhrase(plan: ResolvedPlan): string {
  return plan.csm.kind === "dedicated"
    ? `Dedicated CSM: ${plan.csmName}`
    : `Pooled CSM: ${plan.csmName}`;
}

export function buildChannelTopic(input: ChannelContentInput): string {
  const { plan, schedule } = input;
  const topic = [
    `${plainText(input.customerName)} onboarding`,
    `${plan.label} plan (${plan.durationDays} days)`,
    csmPhrase(plan),
    `Go-live target ${formatShortDate(schedule.dueDate)}`,
  ].join(" · ");
  return truncate(topic, MAX_TOPIC_LENGTH);
}

/** The purpose carries a deal marker so a retry can recognise a channel it already created. */
export function dealMarker(dealId: string): string {
  return `[deal:${dealId}]`;
}

export function buildChannelPurpose(input: ChannelContentInput): string {
  const purpose = `NovaCRM ${input.plan.label} onboarding for ${plainText(input.customerName)}. AE: ${plainText(input.aeName)}. ${dealMarker(input.dealId)}`;
  return truncate(purpose, MAX_TOPIC_LENGTH);
}

function dateRange(start: string, end: string): string {
  return start === end
    ? formatShortDate(start)
    : `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

function safeHttpsUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const hasBreakout = LINK_BREAKOUT_RE.test(url);
    return parsed.protocol === "https:" && !hasBreakout ? parsed.href : null;
  } catch {
    return null;
  }
}

function intro(input: ChannelContentInput): string {
  const { plan } = input;
  const customer = escapeSlack(input.customerName);
  const contact = input.customerContactName
    ? `, ${escapeSlack(input.customerContactName)}`
    : "";
  const greeting = `:wave: Welcome to your onboarding channel, *${customer}*${contact}!`;
  const ae = escapeSlack(input.aeName);
  const csm = escapeSlack(plan.csmName);

  if (plan.tier === "enterprise") {
    return `${greeting}\n\nYou're on NovaCRM's *Enterprise* plan, which comes with a *${plan.durationDays}-day* onboarding led by your *dedicated CSM, ${csm}*. ${ae} closed your deal and has handed you over to us.`;
  }
  return `${greeting}\n\nYou're on NovaCRM's *Growth* plan, which comes with a streamlined *${plan.durationDays}-day* onboarding supported by our *pooled CSM team (${csm})*. ${ae} closed your deal and has handed you over to us.`;
}

function nextStep(input: ChannelContentInput): string {
  const csm = escapeSlack(input.plan.csmName);
  if (input.plan.tier === "enterprise") {
    return `*Next step:* ${csm} will propose times for your kickoff call right here in this channel. Reply with any dates that don't work.`;
  }
  return "*Next step:* let's schedule your kickoff call. Reply here with two or three times that work for you in the next couple of days and the CS team will confirm.";
}

export function buildWelcomeMessage(input: ChannelContentInput): string {
  const { plan, schedule } = input;
  const heading =
    plan.tier === "enterprise"
      ? "*Your four phases (target dates)*"
      : `*Your four phases (compressed to fit ${plan.durationDays} days)*`;
  const phases = schedule.phases
    .map(
      (phase) =>
        `• *${phase.name}*: ${dateRange(phase.startDate, phase.endDate)}`
    )
    .join("\n");
  const url = safeHttpsUrl(input.projectUrl);
  const tracking = url
    ? `:memo: Follow every task in Rocketlane: <${url}|Open your onboarding project>`
    : ":memo: Your Rocketlane project is being set up and we'll share the link here shortly.";

  return [
    intro(input),
    `${heading}\n${phases}`,
    tracking,
    nextStep(input),
  ].join("\n\n");
}

export interface OpsAlertInput {
  appUrl: string | null;
  customerName: string | null;
  dealId: string;
  detail: string;
  reason: string;
  state: string;
}

export function buildOpsAlert(input: OpsAlertInput): string {
  const lines = [
    ":rotating_light: *Onboarding needs a human*",
    `• Customer: ${escapeSlack(input.customerName ?? "unknown")}`,
    `• Reason: ${escapeSlack(input.reason)}`,
    `• Detail: ${escapeSlack(truncate(input.detail, 500))}`,
    `• Deal: \`${escapeSlack(input.dealId)}\` (state ${escapeSlack(input.state)})`,
  ];
  const base = safeHttpsUrl(input.appUrl);
  if (base) {
    lines.push(`• <${base}|Open the escalation queue>`);
  }
  return lines.join("\n");
}
