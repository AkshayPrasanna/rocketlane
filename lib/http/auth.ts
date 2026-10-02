import { createHash, timingSafeEqual } from "node:crypto";

/** Compares secrets without leaking their length or content through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export interface AuthFailure {
  error: string;
  status: 401 | 503;
}

/**
 * Fails closed: a route whose secret is not configured refuses every request (503), so a
 * missing environment variable can never leave an endpoint open.
 */
export function checkSharedSecret(
  provided: string | null,
  expected: string | undefined
): AuthFailure | null {
  if (!expected) {
    return { error: "This endpoint is not configured", status: 503 };
  }
  if (!(provided && safeEqual(provided, expected))) {
    return { error: "Unauthorized", status: 401 };
  }
  return null;
}

export function failureResponse(failure: AuthFailure): Response {
  return Response.json({ error: failure.error }, { status: failure.status });
}
