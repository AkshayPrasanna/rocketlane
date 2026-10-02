import { createLogger } from "@/lib/logger";
import { getSlackClient } from "@/lib/slack";
import {
  appendToConversation,
  clearStatusContext,
  clearStream,
  logAction,
  saveStatusContext,
  writeStreamEntry,
} from "@/lib/store";
import type {
  BotAction,
  ConversationMessage,
  SlackContext,
  StreamEntry,
} from "@/lib/types";

export async function stepPostToSlack(
  slack: SlackContext,
  text: string
): Promise<void> {
  "use step";

  const { chat } = await import("@/lib/chat");
  const slackAdapter = chat.getAdapter("slack");
  const threadId = slackAdapter.encodeThreadId({
    channel: slack.channelId,
    threadTs: slack.threadTs,
  });

  await slackAdapter.postMessage(threadId, { markdown: text });
}

export async function stepResolveChannelName(
  channelId: string
): Promise<string> {
  "use step";

  try {
    const info = await getSlackClient().conversations.info({
      channel: channelId,
    });
    return info.channel?.name ? `#${info.channel.name}` : "DM";
  } catch (error) {
    createLogger("steps").debug("Failed to resolve channel name", {
      channelId,
      error,
    });
    return "DM";
  }
}

export async function stepGetPermalink(
  channelId: string,
  messageTs: string
): Promise<string | null> {
  "use step";

  try {
    const result = await getSlackClient().chat.getPermalink({
      channel: channelId,
      message_ts: messageTs,
    });
    return result.permalink ?? null;
  } catch (error) {
    createLogger("steps").debug("Failed to get permalink", {
      channelId,
      error,
    });
    return null;
  }
}

export async function stepLogAction(
  action: Omit<BotAction, "id" | "timestamp">,
  conversation?: ConversationMessage[],
  threadKey?: string
): Promise<void> {
  "use step";

  await logAction(action, conversation, threadKey);
}

export async function stepSaveUserMessage(
  threadKey: string,
  messages: ConversationMessage[]
): Promise<void> {
  "use step";

  await appendToConversation(threadKey, messages);
}

export async function stepStartStream(entry: StreamEntry): Promise<void> {
  "use step";

  await writeStreamEntry(entry);
}

export async function stepEndStream(
  threadId: string,
  slack?: { channelId: string; threadTs: string }
): Promise<void> {
  "use step";

  await clearStream(threadId);
  if (slack) {
    await clearStatusContext(slack.channelId, slack.threadTs);
  }
}

export async function stepSaveStatusContext(
  channelId: string,
  threadTs: string
): Promise<void> {
  "use step";

  await saveStatusContext(channelId, threadTs);
}
