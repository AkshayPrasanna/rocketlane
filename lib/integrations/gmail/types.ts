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
  /**
   * Whether Gmail's own checks (DKIM, SPF, DMARC) passed for the From address. `unknown` means
   * the header was absent, which is not treated as a failure.
   */
  senderAuthentication: "pass" | "fail" | "unknown";
  subject: string;
  threadId: string;
}

export interface ReplyInput {
  bodyText: string;
  inReplyTo: string | null;
  /** The Gmail message being answered. Replying to it keeps the reply in the AE's thread. */
  messageId: string;
  subject: string;
  threadId: string;
  to: string;
}

export interface GmailClient {
  /** Creates the label if needed, then applies it. */
  addLabel(messageId: string, labelName: string): Promise<void>;
  getMessage(id: string): Promise<GmailMessage>;
  replyInThread(input: ReplyInput): Promise<{ messageId: string }>;
}
