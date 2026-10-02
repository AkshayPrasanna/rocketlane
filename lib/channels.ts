import type { ChannelConfig } from "./types";

/**
 * Channel configuration for the community workspace.
 *
 * These map to existing channels in your Slack workspace — the bot
 * does not create them. Edit this to match your actual channel setup.
 *
 * Keys are Slack channel names (without the #).
 * The routing tool uses `topics` to decide where to send questions.
 * Set `isWelcomeChannel` on the channel where new members should be greeted.
 */
export const channels: Record<string, ChannelConfig> = {
  general: {
    name: "general",
    description: "General discussion and announcements",
    topics: ["announcements", "general discussion", "community news"],
  },
  help: {
    name: "help",
    description: "Get help with questions and issues",
    topics: ["help", "questions", "support", "troubleshooting", "how-to"],
  },
  bugs: {
    name: "bugs",
    description: "Report and track bugs",
    topics: ["bug reports", "errors", "crashes", "broken features"],
  },
  introductions: {
    name: "introductions",
    description: "New members introduce themselves",
    topics: ["introductions", "new members"],
    isWelcomeChannel: true,
  },
};

export function getWelcomeChannel(): ChannelConfig | undefined {
  return Object.values(channels).find((ch) => ch.isWelcomeChannel);
}

export function formatChannelGuide(): string {
  return Object.values(channels)
    .map(
      (ch) =>
        `#${ch.name} — ${ch.description} (topics: ${ch.topics.join(", ")})`
    )
    .join("\n");
}
