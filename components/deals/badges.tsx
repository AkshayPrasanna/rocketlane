import { Badge } from "@/components/ui/badge";
import { OUTCOME_TONE } from "@/lib/dashboard/labels";
import { STATE_META, type Tone } from "@/lib/dashboard/state-meta";
import type { AuditOutcome, PlanTier } from "@/lib/domain/schemas";
import type { DealState } from "@/lib/domain/states";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  progress: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function ToneBadge({
  children,
  className,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  tone: Tone;
}) {
  return (
    <Badge className={cn(TONE_CLASSES[tone], className)} variant="outline">
      {children}
    </Badge>
  );
}

export function StateBadge({ state }: { state: DealState }) {
  const meta = STATE_META[state];
  return (
    <span title={meta.hint}>
      <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
    </span>
  );
}

export function TierBadge({ tier }: { tier: PlanTier | null }) {
  if (!tier) {
    return <span className="text-muted-foreground text-xs">Not confirmed</span>;
  }
  return (
    <Badge variant={tier === "enterprise" ? "default" : "secondary"}>
      {tier === "enterprise" ? "Enterprise · 30d" : "Growth · 14d"}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  return <ToneBadge tone={OUTCOME_TONE[outcome]}>{outcome}</ToneBadge>;
}
