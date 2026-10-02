import type { PlanTier } from "@/lib/domain/schemas";
import { IntegrationError } from "../errors";
import type {
  CallOutcome,
  CallResult,
  ExtractedTier,
  PlaceCallInput,
  TranscriptTurn,
  VoiceProvider,
} from "./types";

type TerminalOutcome = Exclude<CallOutcome, "completed">;

const PROVIDER_STATUS: Record<TerminalOutcome, string> = {
  busy: "busy",
  canceled: "canceled",
  failed: "failed",
  no_answer: "no-answer",
  system_error: "balance-low",
};

/** What the next simulated call does. One entry is consumed per `placeCall`. */
export type CallScript = (
  | { kind: "confirmed"; tier: PlanTier }
  /** The AE says exactly these things; the provider's extraction is whatever you pass. */
  | {
      aeSays: string[];
      extracted: ExtractedTier | null;
      kind: "spoken";
    }
  | { greeting?: string; kind: "voicemail" }
  | { kind: "no_conversation" }
  | { kind: "terminal"; outcome: TerminalOutcome; providerStatus?: string }
  | { error: IntegrationError; kind: "place_call_error" }
) & {
  /** Result lookups that report the call as still in progress before it finishes. */
  pendingPolls?: number;
};

interface SimulatedCall {
  pendingPolls: number;
  result: CallResult;
}

function agentTurns(
  input: PlaceCallInput,
  tierHeard?: string
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [
    {
      speaker: "agent",
      text: `Hello, this is NovaCRM's onboarding assistant. Am I speaking with ${input.aeName}?`,
    },
    {
      speaker: "agent",
      text: `Is ${input.customerName} on the Enterprise plan or the Growth plan?`,
    },
  ];
  if (tierHeard) {
    turns.push({
      speaker: "agent",
      text: `I heard ${tierHeard}. Is that correct?`,
    });
  }
  return turns;
}

function calleeTurns(texts: string[]): TranscriptTurn[] {
  return texts.map((text) => ({ speaker: "callee", text }));
}

function baseResult(
  executionId: string,
  overrides: Partial<CallResult>
): CallResult {
  return {
    answeredByVoicemail: false,
    conversationSeconds: 0,
    errorMessage: null,
    executionId,
    extracted: null,
    isTerminal: true,
    outcome: "completed",
    providerStatus: "completed",
    turns: [],
    ...overrides,
  };
}

function buildResult(
  executionId: string,
  input: PlaceCallInput,
  script: Exclude<CallScript, { kind: "place_call_error" }>
): CallResult {
  switch (script.kind) {
    case "confirmed": {
      const label = script.tier === "enterprise" ? "Enterprise" : "Growth";
      return baseResult(executionId, {
        conversationSeconds: 42,
        extracted: { confirmed: true, planTier: script.tier },
        turns: [
          ...agentTurns(input, label).slice(0, 2),
          ...calleeTurns([`It's the ${label} plan.`]),
          ...agentTurns(input, label).slice(2),
          ...calleeTurns(["Yes, that's correct."]),
        ],
      });
    }
    case "spoken":
      return baseResult(executionId, {
        conversationSeconds: 30,
        extracted: script.extracted,
        turns: [...agentTurns(input), ...calleeTurns(script.aeSays)],
      });
    case "voicemail":
      return baseResult(executionId, {
        answeredByVoicemail: true,
        conversationSeconds: 12,
        turns: [
          ...agentTurns(input),
          ...calleeTurns([
            script.greeting ??
              "You have reached the Enterprise sales team voicemail. Please leave a message after the tone.",
          ]),
        ],
      });
    case "no_conversation":
      return baseResult(executionId, {
        conversationSeconds: 0,
        turns: agentTurns(input).slice(0, 1),
      });
    case "terminal":
      return baseResult(executionId, {
        errorMessage:
          script.outcome === "system_error"
            ? "Simulated provider failure"
            : null,
        outcome: script.outcome,
        providerStatus:
          script.providerStatus ?? PROVIDER_STATUS[script.outcome],
      });
    default:
      throw new Error("Unhandled call script");
  }
}

/**
 * Script-driven stand-in for the voice provider. Running out of script throws, so a test
 * fails loudly if the system dials more often than the scenario allows.
 */
export class MockVoiceProvider implements VoiceProvider {
  readonly placed: PlaceCallInput[] = [];
  resultLookups = 0;
  private readonly script: CallScript[];
  private readonly calls = new Map<string, SimulatedCall>();
  private nextScript = 0;

  constructor(script: CallScript[]) {
    this.script = script;
  }

  placeCall(input: PlaceCallInput): Promise<{ executionId: string }> {
    const step = this.script[this.nextScript];
    if (!step) {
      return Promise.reject(
        new Error(
          `MockVoiceProvider script exhausted: call #${this.placed.length + 1} was not expected`
        )
      );
    }
    this.nextScript += 1;
    this.placed.push(input);

    if (step.kind === "place_call_error") {
      return Promise.reject(step.error);
    }

    const executionId = `exec-${this.placed.length}`;
    this.calls.set(executionId, {
      pendingPolls: step.pendingPolls ?? 0,
      result: buildResult(executionId, input, step),
    });
    return Promise.resolve({ executionId });
  }

  getResult(executionId: string): Promise<CallResult> {
    this.resultLookups += 1;
    const call = this.calls.get(executionId);
    if (!call) {
      return Promise.reject(
        new IntegrationError(
          "voice",
          "not_found",
          `No execution ${executionId}`
        )
      );
    }
    if (call.pendingPolls > 0) {
      call.pendingPolls -= 1;
      return Promise.resolve(
        baseResult(executionId, {
          isTerminal: false,
          outcome: null,
          providerStatus: "in-progress",
        })
      );
    }
    return Promise.resolve(call.result);
  }
}
