import type { MailStore } from "@/lib/store/types";
import { IntegrationError } from "../errors";
import type { GmailClient, GmailMessage, ReplyInput } from "./types";

interface BridgeOptions {
  clock: () => Date;
  newId: () => string;
}

/**
 * The live Gmail integration. A small Apps Script running inside the CS mailbox hands each
 * new deal email to /api/gmail/ingest, which stores it here, and collects the replies queued
 * here to send them from that mailbox. So this client never talks to Gmail directly: it reads
 * what the script delivered and queues what the script should send.
 *
 * In production this would be replaced by the Gmail API with push notifications, which only
 * changes how emails arrive; everything after `registerMessage` stays the same.
 */
export class BridgeGmailClient implements GmailClient {
  private readonly mail: MailStore;
  private readonly options: BridgeOptions;

  constructor(mail: MailStore, options: BridgeOptions) {
    this.mail = mail;
    this.options = options;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const message = await this.mail.getInbound(id);
    if (!message) {
      throw new IntegrationError(
        "gmail",
        "not_found",
        `Message ${id} was never delivered by the Gmail bridge`
      );
    }
    return message;
  }

  async replyInThread(input: ReplyInput): Promise<{ messageId: string }> {
    const id = this.options.newId();
    await this.mail.queueReply({
      bodyText: input.bodyText,
      id,
      inReplyTo: input.inReplyTo,
      messageId: input.messageId,
      queuedAt: this.options.clock().toISOString(),
      subject: input.subject,
      threadId: input.threadId,
      to: input.to,
    });
    return { messageId: id };
  }

  /** The script labels each email itself once the ingest call succeeds. */
  addLabel(_messageId: string, _labelName: string): Promise<void> {
    return Promise.resolve();
  }
}
