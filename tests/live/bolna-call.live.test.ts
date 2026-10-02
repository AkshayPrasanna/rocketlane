import { describe, it } from "vitest";
import { decideTier } from "@/lib/domain/tier-decision";
import { BolnaVoiceProvider } from "@/lib/integrations/voice/bolna";

const POLL_MS = 5000;
const MAX_WAIT_MS = 4 * 60 * 1000;

/**
 * Places ONE real phone call to AE_DEMO_PHONE through Bolna and reports how the system reads
 * it. It rings your phone and uses Bolna credit, so it only runs when you ask for it:
 *
 *   CALL_ME=yes pnpm test:live tests/live/bolna-call.live.test.ts
 *
 * Answer, say which plan the customer is on (try "Enterprise"), then confirm when asked.
 */
describe("a real Bolna call", () => {
  it.skipIf(process.env.CALL_ME !== "yes")(
    "calls the AE and decides the tier",
    async () => {
      const { AE_DEMO_NAME, AE_DEMO_PHONE, BOLNA_AGENT_ID, BOLNA_API_KEY } =
        process.env;
      if (!(AE_DEMO_PHONE && BOLNA_AGENT_ID && BOLNA_API_KEY)) {
        throw new Error(
          "Set AE_DEMO_PHONE, BOLNA_AGENT_ID and BOLNA_API_KEY in .env.local"
        );
      }
      const voice = new BolnaVoiceProvider({
        agentId: BOLNA_AGENT_ID,
        apiKey: BOLNA_API_KEY,
      });

      const { executionId } = await voice.placeCall({
        aeName: AE_DEMO_NAME ?? "there",
        aePhone: AE_DEMO_PHONE,
        attempt: 1,
        customerName: "Acme Corp",
        dealId: "live-test",
      });
      console.log(
        `Call placed (execution ${executionId}). Your phone should ring now.`
      );

      const deadline = Date.now() + MAX_WAIT_MS;
      let result = await voice.getResult(executionId);
      while (!result.isTerminal && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        result = await voice.getResult(executionId);
        console.log(`  status: ${result.providerStatus}`);
      }

      console.log(
        "\nFinal status:",
        result.providerStatus,
        "| conversation seconds:",
        result.conversationSeconds
      );
      console.log("Voicemail:", result.answeredByVoicemail);
      console.log("Transcript:");
      for (const turn of result.turns) {
        console.log(
          `  ${turn.speaker === "callee" ? "YOU  " : "AGENT"}: ${turn.text}`
        );
      }
      console.log("Extraction:", JSON.stringify(result.extracted));
      if (result.isTerminal) {
        console.log("DECISION:", JSON.stringify(decideTier(result), null, 2));
      }
    }
  );
});
