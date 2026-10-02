import {
  IntegrationError,
  type IntegrationErrorKind,
  type IntegrationName,
} from "./errors";

export interface Fault {
  kind: IntegrationErrorKind;
  message?: string;
  retryAfterMs?: number;
  status?: number;
  /** How many calls fail before the dependency recovers. Defaults to 1. */
  times?: number;
}

const DEFAULT_STATUS: Partial<Record<IntegrationErrorKind, number>> = {
  rate_limited: 429,
  server_error: 500,
  unauthorized: 401,
};

/**
 * Lets a mock misbehave on demand so the negative paths are testable: API down, 500s,
 * timeouts, rate limits, auth failures. Faults are armed per operation and count down.
 */
export class FaultInjector<Op extends string> {
  private readonly integration: IntegrationName;
  private readonly armed = new Map<Op, Fault & { remaining: number }>();

  constructor(integration: IntegrationName) {
    this.integration = integration;
  }

  arm(op: Op, fault: Fault): void {
    this.armed.set(op, { ...fault, remaining: fault.times ?? 1 });
  }

  /** The dependency is down until `clear()` is called. */
  armDown(op: Op, kind: IntegrationErrorKind = "server_error"): void {
    this.armed.set(op, { kind, remaining: Number.POSITIVE_INFINITY });
  }

  clear(): void {
    this.armed.clear();
  }

  /** Call at the top of each mock operation. Throws if a fault is armed for it. */
  check(op: Op): void {
    const fault = this.armed.get(op);
    if (!fault || fault.remaining <= 0) {
      return;
    }
    fault.remaining -= 1;
    throw new IntegrationError(
      this.integration,
      fault.kind,
      fault.message ?? `Injected ${fault.kind} fault on ${op}`,
      {
        retryAfterMs: fault.retryAfterMs,
        status: fault.status ?? DEFAULT_STATUS[fault.kind],
      }
    );
  }
}
