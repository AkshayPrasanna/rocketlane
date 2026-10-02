import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/deals/auto-refresh";
import { ToneBadge } from "@/components/deals/badges";
import { Header } from "@/components/header";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/admin-session";
import { getDashboardQueries } from "@/lib/dashboard/get-queries";
import { REASON_LABELS } from "@/lib/dashboard/labels";
import { resolveEscalationAction } from "./actions";

export default function EscalationsPage() {
  return (
    <>
      <Header
        description="Deals the agents stopped on and handed to a person"
        title="Escalation queue"
      />
      <div className="flex-1 space-y-4 p-4">
        <AutoRefresh />
        <Suspense fallback={<Skeleton className="h-64" />}>
          <EscalationsContent />
        </Suspense>
      </div>
    </>
  );
}

async function EscalationsContent() {
  await requireAdmin();
  const rows = await getDashboardQueries().escalationRows();
  const open = rows.filter((row) => row.escalation.resolvedAt === null).length;

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-muted-foreground text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Nothing needs a human right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <p className="text-sm">
        <span className="font-semibold">{open}</span> open,{" "}
        <span className="text-muted-foreground">
          {rows.length - open} resolved
        </span>
      </p>
      <div className="space-y-3">
        {rows.map(({ customerName, escalation }) => {
          const resolved = escalation.resolvedAt !== null;
          return (
            <Card className={resolved ? "opacity-60" : ""} key={escalation.id}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge tone={resolved ? "neutral" : "danger"}>
                    {resolved ? "Resolved" : "Open"}
                  </ToneBadge>
                  <span className="font-medium text-sm">
                    {REASON_LABELS[escalation.reason]}
                  </span>
                  <Link
                    className="text-info text-sm hover:underline"
                    href={`/deals/${escalation.dealId}`}
                  >
                    {customerName}
                  </Link>
                  <span className="ml-auto text-muted-foreground text-xs">
                    <LocalTime iso={escalation.createdAt} withDate />
                  </span>
                </div>
                <p className="text-sm">{escalation.detail}</p>
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                  <span>
                    Ops Slack alert:{" "}
                    {escalation.opsNotified ? "sent" : "not sent"}
                  </span>
                  {resolved && (
                    <span>
                      Resolved by {escalation.resolvedBy} at{" "}
                      <LocalTime
                        iso={escalation.resolvedAt ?? escalation.createdAt}
                        withDate
                      />
                    </span>
                  )}
                  {!resolved && (
                    <form action={resolveEscalationAction} className="ml-auto">
                      <input name="id" type="hidden" value={escalation.id} />
                      <Button size="sm" type="submit" variant="outline">
                        Mark as handled
                      </Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
