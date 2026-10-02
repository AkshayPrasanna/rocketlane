import type { InboundMessage } from "@/lib/domain/schemas";
import { BridgeGmailClient } from "@/lib/integrations/gmail/bridge";
import { AE, dealEmail } from "./emails";
import { createHarness, FIXED_NOW, type HarnessOptions } from "./harness";

/** A harness whose Gmail is the real bridge client, fed the way the Apps Script would. */
export function createBridgeHarness(options: HarnessOptions = {}) {
  const h = createHarness(options);
  h.deps.gmail = new BridgeGmailClient(h.store.mail, {
    clock: h.deps.clock,
    newId: h.deps.newId,
  });

  const started: string[] = [];
  const start = (dealId: string) => {
    started.push(dealId);
    return Promise.resolve(`run-${started.length}`);
  };

  let counter = 0;
  /** The JSON the script posts for one email. */
  function inbound(
    overrides: Partial<InboundMessage> & {
      email?: { bodyText: string; subject: string };
    } = {}
  ): InboundMessage {
    counter += 1;
    const { email = dealEmail(), ...rest } = overrides;
    return {
      bodyText: email.bodyText,
      from: { email: AE.email, name: AE.name },
      generatedByAgent: false,
      id: `gm-${counter}`,
      labelIds: ["INBOX"],
      receivedAt: FIXED_NOW.toISOString(),
      rfc822MessageId: `<gm-${counter}@mail.test>`,
      senderAuthentication: "pass",
      subject: email.subject,
      threadId: `th-${counter}`,
      ...rest,
    };
  }

  return { ...h, inbound, start, started };
}
