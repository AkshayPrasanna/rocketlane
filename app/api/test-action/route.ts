import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth, isCurrentUserLead } from "@/lib/auth";
import { clearAllActions, logAction, writeStreamEntry } from "@/lib/store";
import type { BotAction, ConversationMessage } from "@/lib/types";

type TestAction = Omit<BotAction, "id" | "timestamp">;

const testConversations: ConversationMessage[][] = [
  [
    { role: "user", content: "How do I deploy this to Vercel?" },
    {
      role: "assistant",
      content:
        'You can deploy by clicking the "Deploy with Vercel" button in the README, or run `vercel` from the command line. Make sure to set your environment variables (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and an AI API key) in the Vercel project settings.',
    },
  ],
  [
    {
      role: "user",
      content: "What's the best channel for reporting a login bug?",
    },
    {
      role: "assistant",
      content:
        "You should report bugs in the #bugs channel. It's specifically dedicated to tracking bugs, errors, and crashes. You can also include steps to reproduce the issue to help the team investigate faster.",
    },
  ],
  [
    {
      role: "user",
      content:
        "I keep getting a 500 error when the bot tries to respond. Any ideas?",
    },
    {
      role: "assistant",
      content:
        "A 500 error usually means the AI API key is missing or invalid. Check that you have either ANTHROPIC_API_KEY or OPENAI_API_KEY set in your environment variables, and that the key is valid. You can also check the Vercel dashboard logs for more details on the error.",
    },
    { role: "user", content: "Found it — my API key had expired. Thanks!" },
    {
      role: "assistant",
      content:
        "Glad that fixed it! If you run into anything else, feel free to ask here or in #help.",
    },
  ],
];

const actions: TestAction[] = [
  {
    type: "answered",
    channel: "#help",
    user: "test.user",
    description: "Answered a question about deployment",
  },
  {
    type: "routed",
    channel: "#bugs",
    description: "Suggested routing question to #bugs",
    metadata: { topic: "error report" },
  },
  {
    type: "welcomed",
    channel: "#introductions",
    user: "new.member",
    description: "Welcomed new member to the community",
  },
  {
    type: "surfaced",
    channel: "#help",
    description: "Found 2 unanswered questions in the last 24 hours",
    metadata: { count: "2", hours: "24" },
  },
  {
    type: "flagged",
    channel: "DM",
    description:
      "Flagged issue to community lead: User reports suspicious activity",
    metadata: { summary: "User reports suspicious activity" },
  },
];

async function requireAuthOrDev() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.NODE_ENV !== "production") {
    return null;
  }
  const isLead = await isCurrentUserLead();
  if (!isLead) {
    return NextResponse.json(
      { error: "Forbidden — lead access required" },
      { status: 403 }
    );
  }
  return null;
}

export async function POST() {
  const denied = await requireAuthOrDev();
  if (denied) {
    return denied;
  }

  const action = actions[Math.floor(Math.random() * actions.length)];

  const conversation =
    action.type === "answered"
      ? testConversations[Math.floor(Math.random() * testConversations.length)]
      : undefined;

  const id = await logAction(action, conversation);
  return NextResponse.json({
    logged: { ...action, id },
    hasConversation: Boolean(conversation),
  });
}

export async function PUT() {
  const denied = await requireAuthOrDev();
  if (denied) {
    return denied;
  }

  const threadId = `TEST:${Date.now()}`;
  await writeStreamEntry({
    threadId,
    channel: "#help",
    prompt: "How do I set up authentication in this project?",
    text: "",
    status: "streaming",
    timestamp: Date.now(),
  });

  return NextResponse.json({ streaming: true, threadId, ttlSeconds: 120 });
}

export async function DELETE() {
  const denied = await requireAuthOrDev();
  if (denied) {
    return denied;
  }

  await clearAllActions();
  return NextResponse.json({ cleared: true });
}
