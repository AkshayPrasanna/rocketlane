import type { ToolSet } from "ai";
import { z } from "zod";
import { channels } from "@/lib/channels";
import { config } from "@/lib/config";
import { createSavoirClient } from "@/lib/savoir";
import { getSlackClient } from "@/lib/slack";
import { getActiveStatusContext, logAction } from "@/lib/store";

const deferLoading = {
  providerOptions: { anthropic: { deferLoading: true } },
};

const savoir = config.savoirApiUrl
  ? createSavoirClient(config.savoirApiUrl, config.savoirApiKey || undefined)
  : null;

/*
 * Shows a tool-specific status in the Slack thread (e.g. "searching the web...").
 * Uses Chat SDK's startTyping() — raw assistant.threads.setStatus calls don't work
 * because Chat SDK manages the Assistants API lifecycle and overrides them.
 *
 * Reads Slack thread context from a global Redis key written at workflow start.
 * Vercel Workflow runs step functions in isolated serverless contexts, so module-level
 * state set in one step isn't available in the next. A single Redis key avoids that,
 * with the trade-off that concurrent workflows can briefly show the wrong status text
 * on a thread (cosmetic only — doesn't affect bot behavior).
 */
async function updateStatus(status: string) {
  try {
    const ctx = await getActiveStatusContext();
    if (!ctx) {
      return;
    }
    const { chat } = await import("@/lib/chat");
    const slackAdapter = chat.getAdapter("slack");
    await slackAdapter.startTyping(
      `slack:${ctx.channelId}:${ctx.threadTs}`,
      status
    );
  } catch {
    /* noop */
  }
}

async function executeBash({ command }: { command: string }) {
  "use step";
  await updateStatus("reading docs...");

  if (!savoir) {
    return {
      stdout: "",
      stderr:
        "Savoir API is not configured. Set SAVOIR_API_URL to enable file search.",
      exitCode: 1,
    };
  }

  const result = await savoir.bash(command);

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

async function executeBashBatch({ commands }: { commands: string[] }) {
  "use step";
  await updateStatus("reading docs...");

  if (!savoir) {
    return {
      results: commands.map((command) => ({
        command,
        stdout: "",
        stderr:
          "Savoir API is not configured. Set SAVOIR_API_URL to enable file search.",
        exitCode: 1,
      })),
    };
  }

  const result = await savoir.bashBatch(commands);

  return {
    results: result.results.map((r) => ({
      command: r.command,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
    })),
  };
}

async function executeWebSearch({ query }: { query: string }) {
  "use step";
  await updateStatus("searching the web...");

  const { generateText, stepCountIs } = await import("ai");
  const { anthropic } = await import("@ai-sdk/anthropic");

  const result = await generateText({
    model: config.model,
    tools: {
      webSearch: anthropic.tools.webSearch_20250305({
        ...(config.searchDomains.length > 0
          ? { allowedDomains: config.searchDomains }
          : {}),
      }),
    },
    prompt: query,
    stopWhen: stepCountIs(5),
  });

  return result.text;
}

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

const bashBatchInputSchema = z.object({
  commands: z
    .array(z.string())
    .describe("List of bash commands to execute in one request"),
});

const suggestChannelInputSchema = z.object({
  topic: z
    .string()
    .describe(
      "A short description of the question or topic to find the right channel for"
    ),
});

async function executeSuggestChannel({ topic }: { topic: string }) {
  "use step";
  await updateStatus("finding the right channel...");

  const topicLower = topic.toLowerCase();

  const scored = Object.values(channels).map((ch) => {
    const score = ch.topics.reduce((acc, t) => {
      const keyword = t.toLowerCase();
      return (
        acc +
        (topicLower.includes(keyword) || keyword.includes(topicLower) ? 1 : 0)
      );
    }, 0);
    return { channel: ch, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return {
      suggested: null,
      description: null,
      confidence: "no_match",
      allChannels: "",
    };
  }
  const allChannels = Object.values(channels)
    .map((ch) => `#${ch.name} — ${ch.description}`)
    .join("\n");

  await logAction({
    type: "routed",
    channel: best.score > 0 ? `#${best.channel.name}` : "#general",
    description:
      best.score > 0
        ? `Suggested routing question to #${best.channel.name}`
        : `Helped with channel routing (topic: ${topic})`,
    metadata: { topic },
  });

  return {
    suggested: best.score > 0 ? `#${best.channel.name}` : null,
    description: best.score > 0 ? best.channel.description : null,
    confidence: best.score > 0 ? "match" : "no_match",
    allChannels,
  };
}

const unansweredInputSchema = z.object({
  channel: z
    .string()
    .describe(
      'Channel name to scan (without #), e.g. "help". If you receive a Slack channel ID like C0AJGCJSCES, pass it as-is.'
    ),
  hours: z
    .number()
    .optional()
    .describe("How many hours back to look (default: 24)"),
});

const LEADING_HASH_RE = /^#/;
const SLACK_MENTION_RE = /^<#(\w+)\|?(\w*)>$/;
const CHANNEL_ID_RE = /^[A-Z0-9]+$/;

function parseChannelInput(raw: string): string {
  const cleaned = raw.replace(LEADING_HASH_RE, "");
  const slackMention = cleaned.match(SLACK_MENTION_RE);
  if (slackMention) {
    return slackMention[1];
  }
  return cleaned;
}

async function executeUnanswered({
  channel,
  hours = 24,
}: {
  channel: string;
  hours?: number;
}) {
  "use step";
  await updateStatus("scanning for unanswered questions...");

  const parsed = parseChannelInput(channel);
  const isChannelId = CHANNEL_ID_RE.test(parsed) && parsed.startsWith("C");
  const slack = getSlackClient();

  let channelId: string;
  let channelName: string;

  if (isChannelId) {
    channelId = parsed;
    try {
      const info = await slack.conversations.info({ channel: channelId });
      channelName = info.channel?.name ?? parsed;
    } catch {
      channelName = parsed;
    }
  } else {
    const listResult = await slack.conversations.list({
      types: "public_channel",
      limit: 200,
    });
    const target = listResult.channels?.find((ch) => ch.name === parsed);
    if (!target?.id) {
      return { error: `Channel #${parsed} not found`, questions: [] };
    }
    channelId = target.id;
    channelName = parsed;
  }

  const oldest = String(Math.floor(Date.now() / 1000) - hours * 3600);

  let historyResult: Awaited<ReturnType<typeof slack.conversations.history>>;
  try {
    historyResult = await slack.conversations.history({
      channel: channelId,
      oldest,
      limit: 100,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not_in_channel") || msg.includes("channel_not_found")) {
      return {
        error: `I'm not a member of #${channelName}. Invite me first: /invite @Community Agent in that channel.`,
        questions: [],
      };
    }
    return { error: `Failed to read #${channelName}: ${msg}`, questions: [] };
  }

  const unanswered = (historyResult.messages ?? [])
    .filter(
      (msg) =>
        !msg.subtype &&
        msg.text &&
        (msg.reply_count === undefined || msg.reply_count === 0)
    )
    .map((msg) => ({
      text: msg.text?.slice(0, 200),
      user: msg.user ?? "unknown",
      ts: msg.ts,
      permalink: `https://slack.com/archives/${channelId}/p${msg.ts?.replace(".", "")}`,
    }));

  if (unanswered.length > 0) {
    await logAction({
      type: "surfaced",
      channel: `#${channelName}`,
      description: `Found ${unanswered.length} unanswered question${unanswered.length === 1 ? "" : "s"} in the last ${hours} hours`,
      metadata: { count: String(unanswered.length), hours: String(hours) },
    });
  }

  return {
    channel: `#${channelName}`,
    hoursScanned: hours,
    count: unanswered.length,
    questions: unanswered.slice(0, 10),
  };
}

const flagInputSchema = z.object({
  summary: z.string().describe("Brief summary of the issue being flagged"),
  context: z
    .string()
    .describe(
      "Relevant context: what was asked, what channel, why it needs human attention"
    ),
  permalink: z
    .string()
    .optional()
    .describe("Slack permalink to the original message, if available"),
});

async function executeFlagToLead({
  summary,
  context,
  permalink,
}: {
  summary: string;
  context: string;
  permalink?: string;
}) {
  "use step";
  await updateStatus("flagging to community lead...");

  const leadId = config.communityLeadSlackId;
  if (!leadId) {
    return {
      success: false,
      error: "No community lead configured. Set COMMUNITY_LEAD_SLACK_ID.",
    };
  }

  const slack = getSlackClient();

  const message = [
    ":rotating_light: *Flagged for review*",
    "",
    `*Summary:* ${summary}`,
    "",
    context,
    permalink ? `\n<${permalink}|View in Slack>` : "",
  ].join("\n");

  try {
    await slack.chat.postMessage({
      channel: leadId,
      text: message,
    });

    await logAction({
      type: "flagged",
      channel: "DM",
      description: `Flagged issue to community lead: ${summary}`,
      metadata: { summary },
    });

    return { success: true, message: "Issue flagged to community lead." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to flag: ${msg}` };
  }
}

export const durableTools: ToolSet = {
  suggest_channel: {
    description: `REQUIRED tool for any channel routing question. You MUST call this tool whenever someone asks where to post, which channel to use, or where to go for something. Do NOT answer routing questions with plain text — always call this tool first so the action is tracked.

Returns the suggested channel and a list of all available channels.

Examples of questions that REQUIRE this tool:
  "where do I report a bug" → call with topic "bug report"
  "how do I fix this error" → call with topic "error help"
  "where should I post this" → call with topic from their message
  "which channel for introductions" → call with topic "introductions"`,
    inputSchema: suggestChannelInputSchema,
    execute: executeSuggestChannel,
  },
  unanswered: {
    description: `Scan a channel for recent messages that haven't received any replies. Use this when someone asks about unanswered questions or when you want to help surface threads that need attention.

Returns up to 10 unanswered messages with text previews and permalinks.

Examples:
  channel: "help"              → unanswered questions in #help (last 24h)
  channel: "bugs", hours: 48   → unanswered bug reports in the last 2 days`,
    inputSchema: unansweredInputSchema,
    execute: executeUnanswered,
  },
  bash: {
    description: `Execute a bash command to search and read knowledge base files.

Available commands: ls, cat, head, tail, grep, find, wc, sort, uniq, cut, awk, sed, etc.

Examples:
  ls -la                    # List files with details
  cat docs/file.txt         # View file contents
  grep -r 'pattern' .       # Search file contents recursively
  find . -name '*.md'       # Find files by pattern`,
    inputSchema: bashInputSchema,
    execute: executeBash,
    ...deferLoading,
  },
  bash_batch: {
    description: `Execute multiple bash commands in one request (more efficient than multiple single calls). Use when you need to run several commands, e.g. listing files and then reading multiple.

Example: ["ls -la", "cat README.md", "grep -r 'auth' docs/"]`,
    inputSchema: bashBatchInputSchema,
    execute: executeBashBatch,
    ...deferLoading,
  },
  web_search: {
    description: `Search the web for current information. Use when someone asks a question that requires up-to-date knowledge, documentation lookups, or facts you're not certain about.${config.searchDomains.length > 0 ? ` Searches are scoped to: ${config.searchDomains.join(", ")}` : ""}`,
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    execute: executeWebSearch,
  },
  flag_to_lead: {
    description: `Flag a tricky issue to a community lead for human review. Use this when you encounter a question or situation you cannot confidently handle — for example, sensitive topics, complex technical issues requiring expert knowledge, or potential policy violations.

The community lead will receive a Slack DM with your summary and context.`,
    inputSchema: flagInputSchema,
    execute: executeFlagToLead,
    ...deferLoading,
  },
};
