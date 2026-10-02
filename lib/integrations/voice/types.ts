/**
 * Provider-neutral call model. The live Bolna adapter maps Bolna's statuses and transcript
 * into these types, so the tier-decision rule never depends on a specific vendor.
 */
export type CallOutcome =
  | "completed"
  | "no_answer"
  | "busy"
  | "failed"
  | "canceled"
  /** The provider itself failed (e.g. balance-low, error). Not the AE's fault, so never retried. */
  | "system_error";

export interface TranscriptTurn {
  /** `callee` is the AE. `agent` is our voice agent. */
  speaker: "agent" | "callee";
  text: string;
}

/** What the provider's post-call extraction claims. Advisory only: our rule re-checks it. */
export interface ExtractedTier {
  confirmed: boolean | null;
  planTier: "enterprise" | "growth" | "unclear" | null;
}

export interface CallResult {
  answeredByVoicemail: boolean;
  conversationSeconds: number;
  errorMessage: string | null;
  executionId: string;
  extracted: ExtractedTier | null;
  isTerminal: boolean;
  /** Null while the call is still in progress. */
  outcome: CallOutcome | null;
  /** The raw provider status, kept for the audit log. */
  providerStatus: string;
  turns: TranscriptTurn[];
}

export interface PlaceCallInput {
  aeName: string;
  aePhone: string;
  attempt: number;
  customerName: string;
  dealId: string;
}

export interface VoiceProvider {
  /** The authoritative source of a call's state. Webhooks are only a trigger to call this. */
  getResult(executionId: string): Promise<CallResult>;
  placeCall(input: PlaceCallInput): Promise<{ executionId: string }>;
}
