export interface GmailAddress {
  email: string;
  name: string | null;
}

export interface GmailMessage {
  bodyText: string;
  /** Sender from the From header. This is the only trusted identity of the AE. */
  from: GmailAddress;
  /** True when this mailbox's own agent sent the message (marked by a header on every send). */
  generatedByAgent: boolean;
  id: string;
  labelIds: string[];
  receivedAt: string;
  /** The RFC 822 Message-ID header, needed to thread a reply under the original. */
  rfc822MessageId: string | null;
  subject: string;
  threadId: string;
}

export interface ReplyInput {
  bodyText: string;
  inReplyTo: string | null;
  subject: string;
  threadId: string;
  to: string;
}

export interface GmailClient {
  /** Creates the label if needed, then applies it. */
  addLabel(messageId: string, labelName: string): Promise<void>;
  /** Message IDs added since `startHistoryId` (push path), plus the new high-water mark. */
  fetchHistory(
    startHistoryId: string
  ): Promise<{ historyId: string; messageIds: string[] }>;
  getMessage(id: string): Promise<GmailMessage>;
  replyInThread(input: ReplyInput): Promise<{ messageId: string }>;
  /** Message IDs matching a Gmail search query (poll fallback). */
  searchMessageIds(query: string): Promise<string[]>;
  /** Registers (or renews) the Pub/Sub watch. Must run at least every 7 days. */
  startWatch(): Promise<{ expiresAt: string; historyId: string }>;
}
