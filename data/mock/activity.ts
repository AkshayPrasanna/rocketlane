import type { BotAction, ConversationMessage } from "@/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function daysAgo(days: number, offsetHours = 0): number {
  return Date.now() - days * DAY - offsetHours * HOUR;
}

export const mockActions: BotAction[] = [
  // Today — busy day, 7 actions
  {
    id: "mock-1",
    type: "answered",
    channel: "#help",
    user: "sarah.chen",
    description: "Answered a question about authentication setup",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567890" },
    timestamp: daysAgo(0, 1),
  },
  {
    id: "mock-2",
    type: "answered",
    channel: "#help",
    user: "priya.patel",
    description: "Explained how streaming responses work with the AI SDK",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567891" },
    timestamp: daysAgo(0, 3),
  },
  {
    id: "mock-3",
    type: "routed",
    channel: "#general",
    user: "mike.johnson",
    description: "Suggested moving bug report from #general to #bugs",
    metadata: { suggestedChannel: "#bugs" },
    timestamp: daysAgo(0, 4),
  },
  {
    id: "mock-4",
    type: "answered",
    channel: "#help",
    user: "tom.wilson",
    description: "Helped debug a webhook signature verification error",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567892" },
    timestamp: daysAgo(0, 6),
  },
  {
    id: "mock-5",
    type: "welcomed",
    channel: "#introductions",
    user: "alex.rivera",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(0, 7),
  },
  {
    id: "mock-6",
    type: "answered",
    channel: "#bugs",
    user: "emma.davis",
    description:
      "Confirmed a reported CSS rendering issue and linked to the fix PR",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567893" },
    timestamp: daysAgo(0, 9),
  },
  {
    id: "mock-7",
    type: "surfaced",
    channel: "#help",
    description: "Found 4 unanswered questions in the last 24 hours",
    metadata: { count: "4", hours: "24" },
    timestamp: daysAgo(0, 11),
  },

  // Yesterday — moderate day, 5 actions
  {
    id: "mock-8",
    type: "answered",
    channel: "#help",
    user: "nina.kumar",
    description: "Helped with Redis configuration for local development",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567894" },
    timestamp: daysAgo(1, 2),
  },
  {
    id: "mock-9",
    type: "answered",
    channel: "#help",
    user: "carlos.mendez",
    description: "Walked through setting up Slack OAuth with Better Auth",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567895" },
    timestamp: daysAgo(1, 5),
  },
  {
    id: "mock-10",
    type: "routed",
    channel: "#general",
    user: "lisa.zhang",
    description: "Redirected deployment question to #help",
    metadata: { suggestedChannel: "#help" },
    timestamp: daysAgo(1, 8),
  },
  {
    id: "mock-11",
    type: "answered",
    channel: "#help",
    user: "jordan.lee",
    description: "Explained how to add custom tools to the agent workflow",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567896" },
    timestamp: daysAgo(1, 11),
  },
  {
    id: "mock-12",
    type: "welcomed",
    channel: "#introductions",
    user: "aisha.khan",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(1, 14),
  },

  // 2 days ago — peak day, 8 actions (maybe a launch or event)
  {
    id: "mock-13",
    type: "answered",
    channel: "#help",
    user: "david.park",
    description: "Answered question about environment variable configuration",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567897" },
    timestamp: daysAgo(2, 1),
  },
  {
    id: "mock-14",
    type: "welcomed",
    channel: "#introductions",
    user: "sofia.garcia",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(2, 2),
  },
  {
    id: "mock-15",
    type: "answered",
    channel: "#help",
    user: "james.wright",
    description:
      "Explained the difference between Chat SDK subscriptions and polling",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567898" },
    timestamp: daysAgo(2, 4),
  },
  {
    id: "mock-16",
    type: "welcomed",
    channel: "#introductions",
    user: "maya.patel",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(2, 5),
  },
  {
    id: "mock-17",
    type: "routed",
    channel: "#general",
    user: "rachel.green",
    description: "Suggested moving CI/CD discussion to #help",
    metadata: { suggestedChannel: "#help" },
    timestamp: daysAgo(2, 7),
  },
  {
    id: "mock-18",
    type: "answered",
    channel: "#help",
    user: "lucas.berg",
    description: "Helped troubleshoot a Vercel Workflow timeout",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567899" },
    timestamp: daysAgo(2, 9),
  },
  {
    id: "mock-19",
    type: "welcomed",
    channel: "#introductions",
    user: "olivia.martinez",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(2, 11),
  },
  {
    id: "mock-20",
    type: "answered",
    channel: "#help",
    user: "ethan.brown",
    description:
      "Answered question about AI SDK tool definitions and parameters",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567900" },
    timestamp: daysAgo(2, 14),
  },

  // 3 days ago — quiet day, 3 actions
  {
    id: "mock-21",
    type: "answered",
    channel: "#help",
    user: "noah.kim",
    description: "Explained durable workflow retry semantics",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567901" },
    timestamp: daysAgo(3, 3),
  },
  {
    id: "mock-22",
    type: "answered",
    channel: "#help",
    user: "chloe.taylor",
    description: "Helped with Next.js middleware configuration for auth",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567902" },
    timestamp: daysAgo(3, 9),
  },
  {
    id: "mock-23",
    type: "surfaced",
    channel: "#bugs",
    description: "Found 2 unanswered bug reports in the last 48 hours",
    metadata: { count: "2", hours: "48" },
    timestamp: daysAgo(3, 14),
  },

  // 4 days ago — 5 actions
  {
    id: "mock-24",
    type: "answered",
    channel: "#help",
    user: "ava.williams",
    description: "Answered question about deploying to Vercel with Redis",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567903" },
    timestamp: daysAgo(4, 1),
  },
  {
    id: "mock-25",
    type: "flagged",
    channel: "DM",
    description:
      "Flagged issue to community lead: User reporting harassment in DMs",
    metadata: { summary: "User reporting harassment in DMs" },
    timestamp: daysAgo(4, 4),
  },
  {
    id: "mock-26",
    type: "answered",
    channel: "#help",
    user: "liam.chen",
    description: "Helped debug an API route returning 500 on Vercel",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567904" },
    timestamp: daysAgo(4, 8),
  },
  {
    id: "mock-27",
    type: "routed",
    channel: "#general",
    user: "isabella.jones",
    description: "Suggested moving error report to #bugs",
    metadata: { suggestedChannel: "#bugs" },
    timestamp: daysAgo(4, 11),
  },
  {
    id: "mock-28",
    type: "answered",
    channel: "#help",
    user: "mason.liu",
    description: "Clarified how the bot handles follow-up messages in threads",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567905" },
    timestamp: daysAgo(4, 15),
  },

  // 5 days ago — slow weekend day, 2 actions
  {
    id: "mock-29",
    type: "answered",
    channel: "#help",
    user: "harper.davis",
    description: "Answered question about customizing the system prompt",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567906" },
    timestamp: daysAgo(5, 6),
  },
  {
    id: "mock-30",
    type: "welcomed",
    channel: "#introductions",
    user: "ben.foster",
    description: "Welcomed new member to the community",
    timestamp: daysAgo(5, 12),
  },

  // 6 days ago — 4 actions
  {
    id: "mock-31",
    type: "answered",
    channel: "#help",
    user: "zoe.anderson",
    description: "Explained how to set up the admin panel without Redis",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567907" },
    timestamp: daysAgo(6, 2),
  },
  {
    id: "mock-32",
    type: "routed",
    channel: "#general",
    user: "daniel.moore",
    description: "Redirected feature request to #help",
    metadata: { suggestedChannel: "#help" },
    timestamp: daysAgo(6, 5),
  },
  {
    id: "mock-33",
    type: "answered",
    channel: "#help",
    user: "ella.thompson",
    description: "Helped configure channel routing for a new workspace",
    metadata: { permalink: "https://slack.com/archives/C0EXAMPLE/p1234567908" },
    timestamp: daysAgo(6, 10),
  },
  {
    id: "mock-34",
    type: "surfaced",
    channel: "#help",
    description: "Found 1 unanswered question in the last 24 hours",
    metadata: { count: "1", hours: "24" },
    timestamp: daysAgo(6, 15),
  },
];

export const mockConversations: Record<string, ConversationMessage[]> = {
  "mock-1": [
    {
      role: "user",
      content: "How do I set up authentication in this project?",
      timestamp: daysAgo(0, 1),
    },
    {
      role: "assistant",
      content:
        "You can set up authentication by configuring the `BETTER_AUTH_SECRET` environment variable and adding Slack OAuth credentials. Check the README for the full setup guide.",
      timestamp: daysAgo(0, 1),
    },
  ],
  "mock-2": [
    {
      role: "user",
      content:
        "How does streaming work? I see the bot typing indicator but the response appears all at once.",
      timestamp: daysAgo(0, 3),
    },
    {
      role: "assistant",
      content:
        'The bot streams its response to Redis in real-time (visible in the admin panel), but posts the final message to Slack as a single reply once generation is complete. This avoids rate limits from editing the message repeatedly. The "typing" indicator comes from `chat.postMessage` with a status emoji while the workflow runs.',
      timestamp: daysAgo(0, 3),
    },
  ],
  "mock-8": [
    {
      role: "user",
      content: "I'm having trouble connecting Redis locally. Any tips?",
      timestamp: daysAgo(1, 2),
    },
    {
      role: "assistant",
      content:
        "For local Redis, you can use Upstash Redis (free tier). Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in your `.env.local`. If you just want to see the admin panel, you can skip Redis entirely — it falls back to mock data.",
      timestamp: daysAgo(1, 2),
    },
  ],
  "mock-9": [
    {
      role: "user",
      content:
        "I followed the README but Slack OAuth keeps redirecting to an error page. What am I missing?",
      timestamp: daysAgo(1, 5),
    },
    {
      role: "assistant",
      content:
        "Make sure your Slack app's redirect URL matches exactly: `https://your-domain.com/api/auth/callback/slack`. Also check that `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set in `.env.local` — these come from your Slack app's OAuth & Permissions page, not the Bot Token.",
      timestamp: daysAgo(1, 5),
    },
  ],
  "mock-21": [
    {
      role: "user",
      content:
        "What happens if a workflow step fails? Does it retry the whole thing?",
      timestamp: daysAgo(3, 3),
    },
    {
      role: "assistant",
      content:
        "No, Vercel Workflows checkpoint after each `step.run()` call. If a step fails, it retries just that step — earlier steps aren't re-executed. The AI SDK call is wrapped in a single step, so if the model call fails (e.g. rate limit), it retries the generation without re-fetching thread history or re-posting the typing indicator.",
      timestamp: daysAgo(3, 3),
    },
  ],
};
