import { buildCompletionEmail } from "@/lib/communication/emails";
import {
  buildChannelPurpose,
  buildChannelTopic,
  buildWelcomeMessage,
  type ChannelContentInput,
  dealMarker,
} from "@/lib/communication/messages";
import { buildChannelName } from "@/lib/domain/channel-name";
import { computeSchedule } from "@/lib/domain/schedule";
import type { ChannelRef, DealRecord } from "@/lib/domain/schemas";
import { IntegrationError } from "@/lib/integrations/errors";
import type { SlackChannel } from "@/lib/integrations/slack/types";
import {
  auditorFor,
  backoffSeconds,
  describeError,
  escalate,
  requireDeal,
} from "./support";
import type { ChannelStepResult, PipelineDeps } from "./types";

const MAX_NAME_COLLISIONS = 10;

/**
 * Creates the channel, handling a name clash. If the clashing channel was made for this very
 * deal (its purpose carries our marker) it is reused, which makes the step safe to retry.
 * Anyone else's channel is left alone and a numbered suffix is used instead.
 */
async function ensureChannel(
  deps: PipelineDeps,
  deal: DealRecord,
  customerName: string,
  tier: "enterprise" | "growth"
): Promise<{ channel: SlackChannel; collisions: number; reused: boolean }> {
  for (let index = 1; index <= MAX_NAME_COLLISIONS; index++) {
    const name = buildChannelName(customerName, tier, index);
    try {
      const channel = await deps.slack.createChannel(name);
      return { channel, collisions: index - 1, reused: false };
    } catch (error) {
      if (!(error instanceof IntegrationError && error.kind === "conflict")) {
        throw error;
      }
      const existing = await deps.slack.findChannelByName(name);
      if (existing?.purpose.includes(dealMarker(deal.dealId))) {
        return { channel: existing, collisions: index - 1, reused: true };
      }
    }
  }
  throw new IntegrationError(
    "slack",
    "conflict",
    `No free channel name after ${MAX_NAME_COLLISIONS} tries`
  );
}

function describeChannelCreation(reused: boolean, collisions: number): string {
  if (reused) {
    return "A channel with this name already belonged to this deal, so it was reused instead of creating a duplicate.";
  }
  if (collisions > 0) {
    return `The preferred name was taken by an unrelated channel, so ${collisions} numbered suffix(es) were tried.`;
  }
  return "Created a channel named for the customer and plan tier.";
}

export async function createChannel(
  deps: PipelineDeps,
  dealId: string,
  attempt: number
): Promise<ChannelStepResult> {
  const deal = await requireDeal(deps, dealId);
  if (deal.state === "CHANNEL_CREATED" || deal.state === "COMPLETE") {
    return { status: "created" };
  }
  if (deal.state === "ESCALATED_TO_HUMAN") {
    return { status: "failed" };
  }

  const { planTier: tier, parsed, project } = deal;
  if (!(tier && parsed?.customerName && parsed.aeName && project)) {
    throw new Error(
      `Deal ${dealId} reached channel creation without a project`
    );
  }

  const auditor = auditorFor(deps, deal, "communication");
  const plan = deps.settings.plans[tier];
  const content: ChannelContentInput = {
    aeName: parsed.aeName,
    customerContactName: parsed.customerContactName,
    customerName: parsed.customerName,
    dealId,
    plan,
    projectUrl: project.projectUrl,
    schedule: computeSchedule(plan, project.startDate),
  };

  try {
    let channelRef: ChannelRef | null = deal.channel;
    if (!channelRef) {
      const { channel, collisions, reused } = await ensureChannel(
        deps,
        deal,
        parsed.customerName,
        tier
      );
      channelRef = {
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelUrl: channel.url,
        welcomePostedAt: null,
      };
      await deps.store.deals.updateDeal(dealId, { channel: channelRef });
      await auditor.record({
        input: { customerName: parsed.customerName, tier },
        outcome: "success",
        output: {
          channelId: channel.channelId,
          channelName: channel.channelName,
          nameCollisions: collisions,
          reused,
        },
        rationale: describeChannelCreation(reused, collisions),
        step: "create_channel",
      });
    }

    const topic = buildChannelTopic(content);
    await deps.slack.setPurpose(
      channelRef.channelId,
      buildChannelPurpose(content)
    );
    await deps.slack.setTopic(channelRef.channelId, topic);

    if (!channelRef.welcomePostedAt) {
      const text = buildWelcomeMessage(content);
      await deps.slack.postMessage(channelRef.channelId, text);
      channelRef = {
        ...channelRef,
        welcomePostedAt: deps.clock().toISOString(),
      };
      await deps.store.deals.updateDeal(dealId, { channel: channelRef });
      await auditor.record({
        input: { channelId: channelRef.channelId, tier },
        outcome: "success",
        output: { topic, welcomeMessage: text },
        rationale: `Personalised for the ${plan.label} plan: ${plan.durationDays}-day timeline, ${plan.csm.kind} CSM ${plan.csmName}, customer and AE names, project link and next step.`,
        step: "post_welcome",
      });
    }

    try {
      const invite = await deps.slack.inviteExternalUser(
        channelRef.channelId,
        parsed.customerContactEmail ?? ""
      );
      await auditor.record({
        input: { channelId: channelRef.channelId },
        outcome: "success",
        output: { status: invite.status },
        rationale:
          invite.status === "simulated"
            ? "Slack Connect needs a paid plan, so the customer invite is simulated. In production this sends a real Slack Connect invitation."
            : "Sent the Slack Connect invitation to the customer contact.",
        step: "invite_customer",
      });
    } catch (error) {
      await auditor.record({
        input: { channelId: channelRef.channelId },
        outcome: "failure",
        output: { error: describeError(error) },
        rationale:
          "The customer invite failed. The channel and welcome message exist, so onboarding continues and the invite can be re-sent by hand.",
        step: "invite_customer",
      });
    }

    await deps.store.deals.transitionDeal(dealId, "CHANNEL_CREATED", {
      channel: channelRef,
      stateReason: `Slack channel #${channelRef.channelName} is ready`,
    });
    return { status: "created" };
  } catch (error) {
    if (!(error instanceof IntegrationError)) {
      throw error;
    }
    const exhausted = attempt >= deps.settings.retry.maxAttempts;
    if (error.retryable && !exhausted) {
      const delaySeconds = backoffSeconds(
        attempt,
        deps.settings.retry.baseDelaySeconds,
        error.retryAfterMs
      );
      await auditor.record({
        input: { attempt },
        outcome: "retry",
        output: { delaySeconds, error: describeError(error) },
        rationale:
          "Slack returned a retryable error. Backing off and trying again.",
        step: "create_channel",
      });
      return { delaySeconds, status: "retry" };
    }
    await escalate(deps, {
      agent: "communication",
      dealId,
      detail: `Slack channel setup failed after ${attempt} attempt(s): ${describeError(error)}. The Rocketlane project ${project.projectId} was already created.`,
      input: { attempt },
      rationale:
        "The project exists but the customer channel could not be set up, so a human finishes the handoff.",
      reason: "SLACK_FAILURE",
      step: "create_channel",
      toState: "ESCALATED_TO_HUMAN",
    });
    return { status: "failed" };
  }
}

export async function complete(
  deps: PipelineDeps,
  dealId: string
): Promise<void> {
  const deal = await requireDeal(deps, dealId);
  if (deal.state === "COMPLETE") {
    return;
  }
  const auditor = auditorFor(deps, deal, "system");
  const { planTier: tier, parsed, project, channel } = deal;
  if (!(tier && parsed?.customerName && project)) {
    throw new Error(`Deal ${dealId} cannot complete without a project`);
  }
  const plan = deps.settings.plans[tier];

  await deps.store.deals.transitionDeal(dealId, "COMPLETE", {
    stateReason: "Project and Slack channel created",
  });

  let aeNotified = false;
  try {
    const email = buildCompletionEmail(
      {
        channelName: channel?.channelName ?? null,
        customerName: parsed.customerName,
        dueDate: project.dueDate,
        planLabel: plan.label,
        projectUrl: project.projectUrl,
      },
      deal.subject ?? "Deal notification"
    );
    if (deal.gmailThreadId && deal.aeEmail) {
      await deps.gmail.replyInThread({
        bodyText: email.bodyText,
        inReplyTo: null,
        messageId: deal.gmailMessageId,
        subject: email.subject,
        threadId: deal.gmailThreadId,
        to: deal.aeEmail,
      });
      aeNotified = true;
    }
  } catch (error) {
    await auditor.record({
      input: { to: deal.aeEmail },
      outcome: "failure",
      output: { error: describeError(error) },
      rationale:
        "Could not email the AE a summary. Onboarding itself is complete.",
      step: "notify_ae",
    });
  }

  await auditor.record({
    input: { dealId },
    outcome: "success",
    output: {
      aeNotified,
      channel: channel?.channelName ?? null,
      projectId: project.projectId,
      tier,
    },
    rationale:
      "Every step finished: tier confirmed by the AE, project created from the matching template, customer channel ready.",
    step: "complete",
  });
}
