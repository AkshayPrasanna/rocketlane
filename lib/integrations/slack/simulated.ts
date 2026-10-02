import type { SlackSimStore } from "@/lib/store/types";
import { IntegrationError } from "../errors";
import type { ExistingSlackChannel, SlackChannel, SlackClient } from "./types";

interface SimulatedSlackOptions {
  clock: () => Date;
  newId: () => string;
}

/**
 * The Slack integration the demo runs on. Slack is the one system the brief allows to be
 * simulated, so instead of calling the Slack API this records exactly what production would
 * do (channels, topics, messages, Slack Connect invites) in the shared store, and the
 * dashboard renders it. Behaviour mirrors the real API where it matters to the pipeline:
 * names are unique and a clash raises the same `conflict` error as Slack's `name_taken`.
 *
 * In production this is replaced by a client over the Slack Web API (conversations.create,
 * setTopic, setPurpose, chat.postMessage) and Slack Connect (conversations.inviteShared,
 * which needs a paid plan).
 */
export class SimulatedSlackClient implements SlackClient {
  private readonly store: SlackSimStore;
  private readonly options: SimulatedSlackOptions;

  constructor(store: SlackSimStore, options: SimulatedSlackOptions) {
    this.store = store;
    this.options = options;
  }

  async createChannel(name: string): Promise<SlackChannel> {
    const channelId = `C${this.options.newId().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const created = await this.store.createChannel({
      channelId,
      createdAt: this.options.clock().toISOString(),
      name,
      purpose: "",
      topic: "",
      url: `/slack?channel=${channelId}`,
    });
    if (!created) {
      throw new IntegrationError("slack", "conflict", `name_taken: ${name}`);
    }
    return { channelId, channelName: name, url: `/slack?channel=${channelId}` };
  }

  async findChannelByName(name: string): Promise<ExistingSlackChannel | null> {
    const channel = await this.store.getChannelByName(name);
    return channel
      ? {
          channelId: channel.channelId,
          channelName: channel.name,
          purpose: channel.purpose,
          url: channel.url,
        }
      : null;
  }

  async setTopic(channelId: string, topic: string): Promise<void> {
    await this.store.updateChannel(channelId, { topic });
  }

  async setPurpose(channelId: string, purpose: string): Promise<void> {
    await this.store.updateChannel(channelId, { purpose });
  }

  async postMessage(channelId: string, text: string): Promise<{ ts: string }> {
    await this.ensureChannel(channelId);
    const now = this.options.clock();
    const ts = `${Math.floor(now.getTime() / 1000)}.${this.options.newId().replace(/\D/g, "").slice(0, 6).padEnd(6, "0")}`;
    await this.store.appendMessage({
      channelId,
      postedAt: now.toISOString(),
      text,
      ts,
    });
    return { ts };
  }

  async inviteExternalUser(
    channelId: string,
    email: string
  ): Promise<{ status: "invited" | "simulated" }> {
    await this.store.recordInvite({
      channelId,
      email,
      invitedAt: this.options.clock().toISOString(),
    });
    return { status: "simulated" };
  }

  /** Alert channels such as "ops-escalations" are addressed by name and created on first use. */
  private async ensureChannel(channelId: string): Promise<void> {
    if (await this.store.getChannel(channelId)) {
      return;
    }
    await this.store.createChannel({
      channelId,
      createdAt: this.options.clock().toISOString(),
      name: channelId,
      purpose: "Simulated alert channel",
      topic: "",
      url: `/slack?channel=${channelId}`,
    });
  }
}
