import { WebClient } from "@slack/web-api";

let client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!client) {
    client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return client;
}
