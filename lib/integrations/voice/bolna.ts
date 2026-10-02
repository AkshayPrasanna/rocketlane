import { z } from "zod";
import { IntegrationError, kindFromStatus } from "../errors";
import type {
  CallOutcome,
  CallResult,
  ExtractedTier,
  PlaceCallInput,
  TranscriptTurn,
  VoiceProvider,
} from "./types";

const DEFAULT_BASE_URL = "https://api.bolna.ai";
const DEFAULT_TIMEOUT_MS = 15_000;
const MS_PER_SECOND = 1000;
const EXTRACTION_RETRIES = 2;
const EXTRACTION_RETRY_DELAY_MS = 3000;

const callStartedSchema = z.object({
  execution_id: z.string().min(1),
  status: z.string(),
});

/** The parts of Bolna's execution object we use. Everything else is ignored. */
const executionSchema = z.looseObject({
  answered_by_voice_mail: z.boolean().nullish(),
  conversation_duration: z.number().nullish(),
  error_message: z.string().nullish(),
  extracted_data: z.record(z.string(), z.unknown()).nullish(),
  id: z.string().min(1),
  status: z.string().min(1),
  transcript: z.string().nullish(),
});

type FetchLike = typeof fetch;

export interface BolnaOptions {
  agentId: string;
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: FetchLike;
  /** Injected in tests so retries don't wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Statuses after which Bolna's transcript and extraction are final (per its docs). */
const TERMINAL: Record<string, CallOutcome> = {
  balance_low: "system_error",
  busy: "busy",
  canceled: "canceled",
  completed: "completed",
  error: "system_error",
  failed: "failed",
  no_answer: "no_answer",
  stopped: "canceled",
};

/**
 * `call-disconnected` is deliberately absent: it fires the instant the line drops, and
 * `completed` follows seconds later with the final transcript and extraction.
 */
export function mapStatus(status: string): CallOutcome | null {
  return TERMINAL[status.trim().toLowerCase().replace(/-/g, "_")] ?? null;
}

const SPEAKER_LINE_RE = /^(assistant|user):\s?(.*)$/i;

/** Bolna's transcript is "assistant: ...\nuser: ..."; "user" is the person we called. */
export function parseTranscript(
  raw: string | null | undefined
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const match = SPEAKER_LINE_RE.exec(line);
    if (match) {
      turns.push({
        speaker: match[1].toLowerCase() === "user" ? "callee" : "agent",
        text: match[2].trim(),
      });
    } else if (line.trim()) {
      const last = turns.at(-1);
      if (last) {
        last.text += ` ${line.trim()}`;
      }
    }
  }
  return turns.filter((turn) => turn.text.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value Bolna's LLM picked for one extraction (pre-defined answer, else free text). */
function extractionValue(extraction: unknown): string | null {
  if (!isRecord(extraction)) {
    return null;
  }
  const value = extraction.objective ?? extraction.subjective;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTier(value: string | null): ExtractedTier["planTier"] {
  const text = value?.toLowerCase() ?? "";
  if (text.includes("enterprise")) {
    return "enterprise";
  }
  if (text.includes("growth")) {
    return "growth";
  }
  return text.includes("unclear") ? "unclear" : null;
}

function readConfirmed(value: string | null): boolean | null {
  const text = value?.toLowerCase().trim();
  if (text === "yes" || text === "true") {
    return true;
  }
  return text === "no" || text === "false" ? false : null;
}

/**
 * Finds our two extractions anywhere in `extracted_data` (Bolna nests them under a category
 * name). Returns null when neither is present, which the tier rule treats as "not confirmed".
 */
export function readExtraction(data: unknown): ExtractedTier | null {
  if (!isRecord(data)) {
    return null;
  }
  let planTier: string | null = null;
  let confirmed: string | null = null;
  for (const category of Object.values(data)) {
    if (!isRecord(category)) {
      continue;
    }
    planTier ??= extractionValue(category.plan_tier);
    confirmed ??= extractionValue(category.confirmed);
  }
  if (planTier === null && confirmed === null) {
    return null;
  }
  return { confirmed: readConfirmed(confirmed), planTier: readTier(planTier) };
}

/** Turns Bolna's execution object into the provider-neutral result the pipeline decides on. */
export function toCallResult(raw: z.infer<typeof executionSchema>): CallResult {
  const outcome = mapStatus(raw.status);
  return {
    answeredByVoicemail: raw.answered_by_voice_mail === true,
    conversationSeconds: raw.conversation_duration ?? 0,
    errorMessage: raw.error_message ?? null,
    executionId: raw.id,
    extracted: readExtraction(raw.extracted_data),
    isTerminal: outcome !== null,
    outcome,
    providerStatus: raw.status,
    turns: parseTranscript(raw.transcript),
  };
}

/**
 * The live voice integration. Places a real phone call through Bolna and reports on it.
 * Bolna's webhooks only nudge us to look; `getResult` is the source of truth.
 */
export class BolnaVoiceProvider implements VoiceProvider {
  private readonly options: Required<
    Omit<BolnaOptions, "fetchImpl" | "sleep">
  > &
    Pick<BolnaOptions, "fetchImpl" | "sleep">;

  constructor(options: BolnaOptions) {
    this.options = {
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...options,
    };
  }

  async placeCall(input: PlaceCallInput): Promise<{ executionId: string }> {
    const started = await this.request("POST", "/call", callStartedSchema, {
      agent_id: this.options.agentId,
      recipient_phone_number: input.aePhone,
      // Fills {{ae_name}} and {{customer_name}} in the agent's prompt and welcome message.
      // from_phone_number is omitted so Bolna uses its default number.
      user_data: { ae_name: input.aeName, customer_name: input.customerName },
    });
    return { executionId: started.execution_id };
  }

  async getResult(executionId: string): Promise<CallResult> {
    const path = `/executions/${encodeURIComponent(executionId)}`;
    let result = toCallResult(await this.request("GET", path, executionSchema));

    // The final extraction can land a moment after the status turns terminal, so a call that
    // clearly happened but has no extraction yet is looked up again before we judge it.
    for (
      let attempt = 0;
      attempt < EXTRACTION_RETRIES && this.awaitingExtraction(result);
      attempt++
    ) {
      await (this.options.sleep ?? defaultSleep)(EXTRACTION_RETRY_DELAY_MS);
      result = toCallResult(await this.request("GET", path, executionSchema));
    }
    return result;
  }

  private awaitingExtraction(result: CallResult): boolean {
    return (
      result.outcome === "completed" &&
      !result.answeredByVoicemail &&
      result.extracted === null &&
      result.turns.some((turn) => turn.speaker === "callee")
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    const doFetch = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${this.options.baseUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        method,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new IntegrationError(
        "voice",
        timedOut ? "timeout" : "network",
        timedOut
          ? `Bolna did not answer ${method} ${path} within ${this.options.timeoutMs} ms`
          : `Could not reach Bolna for ${method} ${path}`,
        { cause: error }
      );
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new IntegrationError(
        "voice",
        kindFromStatus(response.status),
        `Bolna ${method} ${path} returned HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`,
        {
          retryAfterMs:
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * MS_PER_SECOND
              : undefined,
          status: response.status,
        }
      );
    }

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new IntegrationError(
        "voice",
        "unknown",
        `Bolna ${method} ${path} returned an unexpected response shape`,
        { status: response.status }
      );
    }
    return parsed.data;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
