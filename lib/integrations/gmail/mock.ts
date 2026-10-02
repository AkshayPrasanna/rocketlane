import { IntegrationError } from "../errors";
import { FaultInjector } from "../fault-injector";
import type { GmailClient, GmailMessage, ReplyInput } from "./types";

export type GmailOp =
  | "getMessage"
  | "fetchHistory"
  | "searchMessageIds"
  | "replyInThread"
  | "addLabel"
  | "startWatch";

export interface DeliverInput {
  bodyText: string;
  fromEmail: string;
  fromName?: string | null;
  generatedByAgent?: boolean;
  labelIds?: string[];
  subject: string;
}

export interface SentReply extends ReplyInput {
  messageId: string;
}

/** In-memory inbox. Records everything the agent sends so tests can assert on it. */
export class MockGmailClient implements GmailClient {
  readonly faults = new FaultInjector<GmailOp>("gmail");
  readonly messages = new Map<string, GmailMessage>();
  readonly replies: SentReply[] = [];
  readonly labelsApplied: Array<{ label: string; messageId: string }> = [];
  private readonly order: string[] = [];
  private counter = 0;

  /** A new email arriving in the inbox. Returns its message ID. */
  deliver(input: DeliverInput): string {
    this.counter += 1;
    const id = `msg-${this.counter}`;
    this.messages.set(id, {
      bodyText: input.bodyText,
      from: { email: input.fromEmail, name: input.fromName ?? null },
      generatedByAgent: input.generatedByAgent ?? false,
      id,
      labelIds: input.labelIds ?? ["INBOX"],
      receivedAt: new Date(
        Date.UTC(2026, 9, 2, 10, this.counter)
      ).toISOString(),
      rfc822MessageId: `<${id}@mail.test>`,
      subject: input.subject,
      threadId: `thread-${id}`,
    });
    this.order.push(id);
    return id;
  }

  getMessage(id: string): Promise<GmailMessage> {
    this.faults.check("getMessage");
    const message = this.messages.get(id);
    if (!message) {
      return Promise.reject(
        new IntegrationError("gmail", "not_found", `No message ${id}`)
      );
    }
    return Promise.resolve(message);
  }

  fetchHistory(
    startHistoryId: string
  ): Promise<{ historyId: string; messageIds: string[] }> {
    this.faults.check("fetchHistory");
    const from = Number(startHistoryId);
    return Promise.resolve({
      historyId: String(this.order.length),
      messageIds: this.order.slice(Number.isNaN(from) ? 0 : from),
    });
  }

  searchMessageIds(_query: string): Promise<string[]> {
    this.faults.check("searchMessageIds");
    return Promise.resolve(
      this.order.filter((id) => {
        const labels = this.messages.get(id)?.labelIds ?? [];
        return !labels.includes("processed");
      })
    );
  }

  replyInThread(input: ReplyInput): Promise<{ messageId: string }> {
    this.faults.check("replyInThread");
    this.counter += 1;
    const messageId = `reply-${this.counter}`;
    this.replies.push({ ...input, messageId });
    return Promise.resolve({ messageId });
  }

  addLabel(messageId: string, labelName: string): Promise<void> {
    this.faults.check("addLabel");
    this.labelsApplied.push({ label: labelName, messageId });
    const message = this.messages.get(messageId);
    if (message && !message.labelIds.includes(labelName)) {
      message.labelIds.push(labelName);
    }
    return Promise.resolve();
  }

  startWatch(): Promise<{ expiresAt: string; historyId: string }> {
    this.faults.check("startWatch");
    return Promise.resolve({
      expiresAt: "2026-10-09T10:00:00.000Z",
      historyId: String(this.order.length),
    });
  }
}
