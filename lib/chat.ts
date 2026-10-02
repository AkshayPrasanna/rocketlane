import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { start } from "workflow/api";
import { createLogger } from "@/lib/logger";
import { handleMemberJoined } from "@/lib/welcome";
import { workflowAgent } from "@/workflows/agent-workflow";

const logger = createLogger("chat");

/** Thread IDs follow the format: "slack:CHANNEL_ID:THREAD_TS" */
function parseThreadId(
  threadId: string
): { channelId: string; threadTs: string } | null {
  const parts = threadId.split(":");
  if (parts.length >= 3 && parts[0] === "slack") {
    return { channelId: parts[1], threadTs: parts[2] };
  }
  return null;
}

async function setThinkingStatus(threadId: string): Promise<void> {
  try {
    const slackAdapter = chat.getAdapter("slack");
    await slackAdapter.startTyping(threadId, "is thinking...");
  } catch (error) {
    logger.error("Failed to set assistant status", { error: String(error) });
  }
}

export const chat = new Chat({
  userName: "agent",
  adapters: { slack: createSlackAdapter() },
  state: createRedisState(),
  logger: "info",
});

async function handleMessage(
  thread: {
    id: string;
    post: (text: string) => Promise<unknown>;
    adapter: {
      fetchMessages: (
        threadId: string,
        opts: { limit: number }
      ) => Promise<{
        messages: Array<{
          text: string;
          author: { isMe: boolean };
        }>;
      }>;
    };
  },
  message: { text?: string } | undefined
): Promise<void> {
  const threadInfo = parseThreadId(thread.id);
  if (!threadInfo) {
    await thread.post("Could not parse thread information.");
    return;
  }

  if (!message?.text) {
    await thread.post("Please provide a message for me to process.");
    return;
  }

  await setThinkingStatus(thread.id);

  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const result = await thread.adapter.fetchMessages(thread.id, {
      limit: 100,
    });
    history = result.messages
      .slice(0, -1)
      .filter((msg) => msg.text.trim())
      .map((msg) => ({
        role: msg.author.isMe ? ("assistant" as const) : ("user" as const),
        content: msg.text,
      }));
  } catch (error) {
    logger.error("Failed to fetch thread history", { error: String(error) });
  }

  start(workflowAgent, [
    {
      prompt: message.text,
      history,
      slack: {
        channelId: threadInfo.channelId,
        threadTs: threadInfo.threadTs,
        botToken: process.env.SLACK_BOT_TOKEN ?? "",
      },
    },
  ]).catch((err) => {
    logger.error("Workflow failed to start", { error: String(err) });
    thread
      .post("Sorry, something went wrong processing your message.")
      .catch(() => {
        /* noop */
      });
  });
}

chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await handleMessage(thread, message);
});

chat.onSubscribedMessage(handleMessage);

chat.onMemberJoinedChannel((event) => {
  handleMemberJoined({ user: event.userId, channel: event.channelId }).catch(
    (err) => logger.error("Welcome handler failed", { error: String(err) })
  );
});
