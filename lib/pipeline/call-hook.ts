/**
 * Deterministic so the webhook route and the workflow agree on it without sharing state:
 * the workflow opens a hook with this token before dialling, and the Bolna webhook handler
 * resumes it after looking the token up from the execution ID.
 */
export function callHookToken(dealId: string, attempt: number): string {
  return `call:${dealId}:${attempt}`;
}
