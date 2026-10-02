import { IntegrationError } from "../errors";
import { FaultInjector } from "../fault-injector";
import type { ExistingSlackChannel, SlackChannel, SlackClient } from "./types";

export type SlackOp =
  | "createChannel"
  | "findChannelByName"
  | "setTopic"
  | "setPurpose"
  | "postMessage"
  | "inviteExternalUser";

export interface PostedMessage {
  channelId: string;
  text: string;
}

/**
 * Slack is the one integration allowed to be simulated. In production the invite becomes a
 * real Slack Connect invitation (paid plan); here it is only recorded.
 */
export class MockSlackClient implements SlackClient {
  readonly faults = new FaultInjector<SlackOp>("slack");
  readonly channels = new Map<string, ExistingSlackChannel>();
  readonly posts: PostedMessage[] = [];
  readonly topics = new Map<string, string>();
  readonly invites: Array<{ channelId: string; email: string }> = [];
  private counter = 0;

  /** A channel that already exists, e.g. created by hand or by another deal. */
  seedChannel(name: string, purpose = ""): ExistingSlackChannel {
    this.counter += 1;
    const channel: ExistingSlackChannel = {
      channelId: `C${String(this.counter).padStart(8, "0")}`,
      channelName: name,
      purpose,
      url: `https://mock.slack.test/archives/C${this.counter}`,
    };
    this.channels.set(name, channel);
    return channel;
  }

  createChannel(name: string): Promise<SlackChannel> {
    this.faults.check("createChannel");
    if (this.channels.has(name)) {
      return Promise.reject(
        new IntegrationError("slack", "conflict", `name_taken: ${name}`)
      );
    }
    const { purpose: _purpose, ...channel } = this.seedChannel(name);
    return Promise.resolve(channel);
  }

  findChannelByName(name: string): Promise<ExistingSlackChannel | null> {
    this.faults.check("findChannelByName");
    return Promise.resolve(this.channels.get(name) ?? null);
  }

  setTopic(channelId: string, topic: string): Promise<void> {
    this.faults.check("setTopic");
    this.topics.set(channelId, topic);
    return Promise.resolve();
  }

  setPurpose(channelId: string, purpose: string): Promise<void> {
    this.faults.check("setPurpose");
    for (const channel of this.channels.values()) {
      if (channel.channelId === channelId) {
        channel.purpose = purpose;
      }
    }
    return Promise.resolve();
  }

  postMessage(channelId: string, text: string): Promise<{ ts: string }> {
    this.faults.check("postMessage");
    this.posts.push({ channelId, text });
    return Promise.resolve({ ts: `${this.posts.length}.000000` });
  }

  inviteExternalUser(
    channelId: string,
    email: string
  ): Promise<{ status: "invited" | "simulated" }> {
    this.faults.check("inviteExternalUser");
    this.invites.push({ channelId, email });
    return Promise.resolve({ status: "simulated" });
  }
}
