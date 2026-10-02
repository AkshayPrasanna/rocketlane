import { Check, CircleAlert } from "lucide-react";
import type { ProgressStep } from "@/lib/dashboard/state-meta";
import { cn } from "@/lib/utils";

const DOT: Record<ProgressStep["status"], string> = {
  current: "border-info bg-info/15 text-info",
  done: "border-success bg-success text-white",
  pending: "border-border bg-background text-muted-foreground",
  stopped: "border-destructive bg-destructive text-white",
};

/** The happy path as a row of steps, with the point where a deal stopped highlighted. */
export function ProgressStepper({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3">
      {steps.map((step, index) => (
        <li className="flex items-center gap-2" key={step.label}>
          <span
            aria-hidden
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border font-medium text-xs",
              DOT[step.status],
              step.status === "current" && "animate-pulse"
            )}
          >
            {step.status === "done" && <Check className="h-3.5 w-3.5" />}
            {step.status === "stopped" && (
              <CircleAlert className="h-3.5 w-3.5" />
            )}
            {(step.status === "current" || step.status === "pending") &&
              index + 1}
          </span>
          <span
            className={cn(
              "text-sm",
              step.status === "pending" && "text-muted-foreground",
              step.status === "stopped" && "font-medium text-destructive"
            )}
          >
            {step.label}
            <span className="sr-only"> ({step.status})</span>
          </span>
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className="mx-1 hidden h-px w-4 bg-border sm:block"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
