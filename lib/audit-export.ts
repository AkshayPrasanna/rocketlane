import type { AuditEntry } from "@/lib/domain/schemas";

/**
 * One JSON object per line, oldest first. Entries are already PII-masked when written, so the
 * export can be shared as is.
 */
export function toJsonl(entries: AuditEntry[]): string {
  return entries.length === 0
    ? ""
    : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function exportFilename(dealId: string | null, now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return dealId ? `audit-${dealId}-${stamp}.jsonl` : `audit-${stamp}.jsonl`;
}
