export interface SlackChannel {
  channelId: string;
  channelName: string;
  url: string | null;
}

export interface ExistingSlackChannel extends SlackChannel {
  purpose: string;
}

export interface SlackClient {
  /** Throws IntegrationError with kind `conflict` when the name is already taken. */
  createChannel(name: string): Promise<SlackChannel>;
  findChannelByName(name: string): Promise<ExistingSlackChannel | null>;
  /**
   * Slack Connect invite for the external customer. Needs a paid Slack plan, so the
   * demo simulates it and reports `simulated`.
   */
  inviteExternalUser(
    channelId: string,
    email: string
  ): Promise<{ status: "invited" | "simulated" }>;
  postMessage(channelId: string, text: string): Promise<{ ts: string }>;
  setPurpose(channelId: string, purpose: string): Promise<void>;
  setTopic(channelId: string, topic: string): Promise<void>;
}
