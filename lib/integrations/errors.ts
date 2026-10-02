export type IntegrationName = "gmail" | "voice" | "rocketlane" | "slack";

export type IntegrationErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "bad_request"
  | "not_found"
  | "conflict"
  | "unknown";

const RETRYABLE_KINDS: ReadonlySet<IntegrationErrorKind> = new Set([
  "rate_limited",
  "server_error",
  "timeout",
  "network",
]);

export interface IntegrationErrorOptions {
  cause?: unknown;
  /** From Retry-After style headers, when the provider says how long to back off. */
  retryAfterMs?: number;
  status?: number;
}

/**
 * The one error type every live and mock integration throws. Callers decide retry versus
 * escalate from `retryable` and never need to know which provider failed how.
 */
export class IntegrationError extends Error {
  readonly integration: IntegrationName;
  readonly kind: IntegrationErrorKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    integration: IntegrationName,
    kind: IntegrationErrorKind,
    message: string,
    options: IntegrationErrorOptions = {}
  ) {
    super(`[${integration}] ${message}`, { cause: options.cause });
    this.name = "IntegrationError";
    this.integration = integration;
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

/** Maps an HTTP status to an error kind, shared by the live HTTP clients. */
export function kindFromStatus(status: number): IntegrationErrorKind {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "server_error";
  }
  if (status >= 400) {
    return "bad_request";
  }
  return "unknown";
}
