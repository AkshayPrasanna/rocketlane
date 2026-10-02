import { DurableAgent } from "@workflow/ai/agent";
import type { UIMessageChunk } from "ai";
import { getWritable } from "workflow";
import { buildInstructions } from "@/lib/agent";
import { config } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { AgentInput, AgentResult } from "@/lib/types";
import {
  stepEndStream,
  stepGetPermalink,
  stepLogAction,
  stepPostToSlack,
  stepResolveChannelName,
  stepSaveStatusContext,
  stepSaveUserMessage,
  stepStartStream,
} from "./steps";
import { durableTools } from "./tools";

const ROUTING_PATTERN_RE = /\b(?:post|report|ask|go|head)\b.*\b#(\w+)\b/i;
const CHANNEL_HASH_RE = /#(\w+)/;

export async function workflowAgent(input: AgentInput): Promise<AgentResult> {
  "use workflow";

  const logger = createLogger("agent-workflow");

  logger.info("Workflow started", { promptLength: input.prompt.length });

  let responseText = "No response generated.";
  let success = true;
  let result: {
    messages: Array<{
      role: string;
      content:
        | string
        | Array<{ type: string; text?: string; toolName?: string }>;
    }>;
  } | null = null;

  const streamThreadId = input.slack
    ? `${input.slack.channelId}:${input.slack.threadTs}`
    : undefined;

  try {
    let threadPermalink: string | null = null;
    if (input.slack && !input.slack.channelId.startsWith("D")) {
      threadPermalink = await stepGetPermalink(
        input.slack.channelId,
        input.slack.threadTs
      );
    }

    const systemSuffix = threadPermalink
      ? `\n\nCurrent thread permalink (pass to flag_to_lead if needed): ${threadPermalink}`
      : "";

    if (input.slack) {
      await stepSaveStatusContext(input.slack.channelId, input.slack.threadTs);
    }

    const agent = new DurableAgent({
      model: config.model,
      system: buildInstructions() + systemSuffix,
      tools: durableTools,
    });

    const messages = [
      ...(input.history || []),
      { role: "user" as const, content: input.prompt },
    ];

    if (streamThreadId && input.slack) {
      const streamChannelName = await stepResolveChannelName(
        input.slack.channelId
      );
      await stepStartStream({
        threadId: streamThreadId,
        channel: streamChannelName,
        prompt: input.prompt
          .replace(/<@[A-Z0-9]+>/g, "")
          .replace(/@U[A-Z0-9]{8,}/g, "")
          .trim(),
        text: "",
        status: "streaming",
        timestamp: Date.now(),
      });

      if (input.history?.length) {
        await stepSaveUserMessage(streamThreadId, [
          { role: "user", content: input.prompt, timestamp: Date.now() },
        ]);
      }
    }

    result = await agent.stream({
      messages,
      writable: getWritable<UIMessageChunk>(),
      maxSteps: 50,
    });

    const lastAssistantMessage = result.messages
      .filter((m) => m.role === "assistant")
      .pop();

    if (lastAssistantMessage?.content) {
      if (typeof lastAssistantMessage.content === "string") {
        responseText = lastAssistantMessage.content;
      } else if (Array.isArray(lastAssistantMessage.content)) {
        responseText =
          lastAssistantMessage.content
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("") || "No response generated.";
      }
    }

    logger.info("Agent completed", { responseLength: responseText.length });
  } catch (error) {
    success = false;
    responseText = `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`;
    logger.error("Agent failed", { error: String(error) });
  }

  if (input.slack) {
    const isDM = input.slack.channelId.startsWith("D");
    const isFirstMessage = !input.history?.length;
    const postText =
      isDM && isFirstMessage
        ? `${responseText}\n\n_This conversation may be reviewed by the community lead._`
        : responseText;
    await stepPostToSlack(input.slack, postText);
  }

  if (success && input.slack) {
    const toolCalls =
      result?.messages
        ?.filter((m) => m.role === "assistant" && Array.isArray(m.content))
        .flatMap((m) =>
          (m.content as Array<{ type: string; toolName?: string }>).filter(
            (p) => p.type === "tool-call"
          )
        ) ?? [];

    const toolsWithOwnLogging = [
      "suggest_channel",
      "unanswered",
      "flag_to_lead",
    ];
    const alreadyLogged = toolCalls.some((tc) =>
      toolsWithOwnLogging.includes(tc.toolName ?? "")
    );

    const routingMatch =
      !alreadyLogged && ROUTING_PATTERN_RE.test(responseText);

    if (routingMatch) {
      const channelName = await stepResolveChannelName(input.slack.channelId);
      const match = responseText.match(CHANNEL_HASH_RE);
      const suggestedChannel = match ? `#${match[1]}` : channelName;

      await stepLogAction(
        {
          type: "routed",
          channel: channelName,
          description: `Suggested routing question to ${suggestedChannel}`,
          metadata: {},
        },
        [],
        `${input.slack.channelId}:${input.slack.threadTs}`
      );
    } else if (!alreadyLogged) {
      const channelName = await stepResolveChannelName(input.slack.channelId);

      const isDM = input.slack.channelId.startsWith("D");
      const metadata: Record<string, string> = {};
      if (!isDM) {
        const permalink = await stepGetPermalink(
          input.slack.channelId,
          input.slack.threadTs
        );
        if (permalink) {
          metadata.permalink = permalink;
        }
      }

      const usedTools = toolCalls.map((tc) => ({
        toolName: (tc as { toolName?: string }).toolName ?? "unknown",
      }));

      const conversation = [
        ...(input.history || []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: input.prompt, timestamp: Date.now() },
        {
          role: "assistant" as const,
          content: responseText,
          timestamp: Date.now(),
          ...(usedTools.length > 0 ? { toolCalls: usedTools } : {}),
        },
      ];

      const threadKey = `${input.slack.channelId}:${input.slack.threadTs}`;

      const cleanPrompt = input.prompt
        .replace(/<@[A-Z0-9]+>/g, "")
        .replace(/@U[A-Z0-9]{8,}/g, "")
        .trim();
      const preview =
        cleanPrompt.length > 120
          ? `${cleanPrompt.slice(0, 120)}…`
          : cleanPrompt;

      await stepLogAction(
        {
          type: "answered",
          channel: channelName,
          description: preview || "Answered a community question",
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        },
        conversation,
        threadKey
      );
    }
  }

  if (streamThreadId) {
    await stepEndStream(streamThreadId, input.slack);
  }

  logger.info("Workflow completed", {
    success,
    responseLength: responseText.length,
  });

  return {
    success,
    response: responseText,
  };
}
