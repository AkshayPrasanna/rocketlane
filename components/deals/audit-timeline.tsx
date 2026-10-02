import { LocalTime } from "@/components/local-time";
import { AGENT_LABELS, stepLabel } from "@/lib/dashboard/labels";
import type { AuditEntry } from "@/lib/domain/schemas";
import { OutcomeBadge } from "./badges";

function hasContent(value: unknown): boolean {
  return (
    value !== null && value !== undefined && JSON.stringify(value) !== "{}"
  );
}

/** Every agent action for a deal: when, who, what, the decision and why. */
export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No events recorded yet.</p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l pl-5">
      {entries.map((entry) => (
        <li className="relative" key={entry.id}>
          <span
            aria-hidden
            className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border bg-background"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{stepLabel(entry.step)}</span>
            <OutcomeBadge outcome={entry.outcome} />
            <span className="text-muted-foreground text-xs">
              {AGENT_LABELS[entry.agent]} · <LocalTime iso={entry.timestamp} />
            </span>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            {entry.rationale}
          </p>
          {(hasContent(entry.input) || hasContent(entry.output)) && (
            <details className="mt-1.5 text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Input and output
              </summary>
              <div className="mt-1.5 grid gap-2 lg:grid-cols-2">
                <JsonBlock label="Input" value={entry.input} />
                <JsonBlock label="Output" value={entry.output} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-0.5 font-medium">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
