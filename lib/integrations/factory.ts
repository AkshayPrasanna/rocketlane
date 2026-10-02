import type { Env, IntegrationMode } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { Store } from "@/lib/store/types";
import { BridgeGmailClient } from "./gmail/bridge";
import { MockGmailClient } from "./gmail/mock";
import type { GmailClient } from "./gmail/types";
import { MockRocketlaneClient } from "./rocketlane/mock";
import type { RocketlaneClient } from "./rocketlane/types";
import { SimulatedSlackClient } from "./slack/simulated";
import type { SlackClient } from "./slack/types";
import { BolnaVoiceProvider } from "./voice/bolna";
import { MockVoiceProvider } from "./voice/mock";
import type { VoiceProvider } from "./voice/types";

const logger = createLogger("integrations");

export interface Integrations {
  gmail: GmailClient;
  rocketlane: RocketlaneClient;
  slack: SlackClient;
  voice: VoiceProvider;
}

interface FactoryOptions {
  clock: () => Date;
  newId: () => string;
}

function unavailable(name: string, mode: IntegrationMode): Error {
  return new Error(
    `${name}_MODE=${mode} is not available yet: the live ${name.toLowerCase()} client has not been built.`
  );
}

/** A mock selected outside tests only ever sees the data it was given, so say so loudly. */
function warnMock(name: string): void {
  logger.warn(
    `${name}_MODE=mock: using an in-memory test double. It will not touch the real ${name.toLowerCase()} service.`
  );
}

/**
 * Chooses a live or simulated implementation for each integration from the environment.
 * Only Slack is simulated in the demo. Gmail, voice and Rocketlane run live; their mocks are
 * test doubles and are not meant for a deployed app.
 */
export function createIntegrations(
  env: Env,
  store: Store,
  options: FactoryOptions
): Integrations {
  const { modes } = env;

  let gmail: GmailClient;
  if (modes.gmail === "live") {
    gmail = new BridgeGmailClient(store.mail, options);
  } else {
    warnMock("GMAIL");
    gmail = new MockGmailClient();
  }

  let voice: VoiceProvider;
  if (modes.voice === "live") {
    const { agentId, apiKey } = env.bolna;
    if (!(agentId && apiKey)) {
      throw new Error(
        "VOICE_MODE=live requires BOLNA_API_KEY and BOLNA_AGENT_ID"
      );
    }
    voice = new BolnaVoiceProvider({ agentId, apiKey });
  } else {
    warnMock("VOICE");
    voice = new MockVoiceProvider([]);
  }

  if (modes.rocketlane === "live") {
    throw unavailable("ROCKETLANE", modes.rocketlane);
  }
  warnMock("ROCKETLANE");
  const rocketlane: RocketlaneClient = new MockRocketlaneClient();

  if (modes.slack === "live") {
    throw new Error(
      "SLACK_MODE=live is not supported. Slack is the simulated integration; use SLACK_MODE=mock."
    );
  }
  const slack = new SimulatedSlackClient(store.slack, options);

  return { gmail, rocketlane, slack, voice };
}
