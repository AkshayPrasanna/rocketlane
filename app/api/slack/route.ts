import { after } from "next/server";
import { config } from "@/lib/config";

export async function POST(request: Request) {
  if (config.adminDemoMode || !process.env.SLACK_SIGNING_SECRET) {
    return Response.json(
      {
        error:
          "Slack webhooks are not configured. Remove ADMIN_DEMO_MODE and set SLACK_SIGNING_SECRET before connecting Slack.",
      },
      { status: 503 }
    );
  }

  const { chat } = await import("@/lib/chat");
  return chat.webhooks.slack(request, { waitUntil: (p) => after(() => p) });
}
