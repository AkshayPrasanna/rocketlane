import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/deals/auto-refresh";
import { StateBadge, TierBadge } from "@/components/deals/badges";
import { FormattedTime } from "@/components/formatted-time";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/admin-session";
import { config } from "@/lib/config";
import { getDashboardQueries } from "@/lib/dashboard/get-queries";
import type { PipelineStats } from "@/lib/dashboard/queries";
import type { ProjectRef } from "@/lib/domain/schemas";

export default function DealsPage() {
  return (
    <>
      <Header
        description={`${config.appName}: every deal from email to Slack channel`}
        title="Deals"
      />
      <div className="flex-1 space-y-4 p-4">
        <AutoRefresh />
        <Suspense fallback={<DealsSkeleton />}>
          <DealsContent />
        </Suspense>
      </div>
    </>
  );
}

async function DealsContent() {
  await requireAdmin();
  const { rows, stats } = await getDashboardQueries().dealRows();

  return (
    <>
      <StatCards stats={stats} />
      <Card className="gap-0 py-0">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle className="text-sm">All deals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground text-sm">
              No deals yet. Send a deal email to the CS inbox and it will appear
              here within a minute.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground text-xs">
                  <tr>
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Plan</th>
                    <th className="px-4 py-2 font-medium">AE</th>
                    <th className="px-4 py-2 text-right font-medium">Calls</th>
                    <th className="px-4 py-2 font-medium">Project</th>
                    <th className="px-4 py-2 font-medium">Slack</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(
                    ({
                      aeEmail,
                      callAttempts,
                      customerName,
                      deal,
                      updatedAt,
                    }) => (
                      <tr className="hover:bg-accent/40" key={deal.dealId}>
                        <td className="px-4 py-2.5">
                          <Link
                            className="font-medium hover:underline"
                            href={`/deals/${deal.dealId}`}
                          >
                            {customerName}
                          </Link>
                          <p className="max-w-[18rem] truncate text-muted-foreground text-xs">
                            {deal.stateReason}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <StateBadge state={deal.state} />
                        </td>
                        <td className="px-4 py-2.5">
                          <TierBadge tier={deal.planTier} />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {deal.parsed?.aeName ?? aeEmail}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {callAttempts}
                        </td>
                        <td className="px-4 py-2.5">
                          <ProjectCell project={deal.project} />
                        </td>
                        <td className="px-4 py-2.5">
                          {deal.channel ? (
                            <Link
                              className="text-info underline-offset-2 hover:underline"
                              href={`/slack?channel=${deal.channel.channelId}`}
                            >
                              #{deal.channel.channelName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          <FormattedTime timestamp={updatedAt} />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ProjectCell({ project }: { project: ProjectRef | null }) {
  if (!project) {
    return <span className="text-muted-foreground">-</span>;
  }
  if (!project.projectUrl) {
    return <>{project.projectId}</>;
  }
  return (
    <a
      className="text-info underline-offset-2 hover:underline"
      href={project.projectUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      {project.projectId}
    </a>
  );
}

function StatCards({ stats }: { stats: PipelineStats }) {
  const cards = [
    { label: "In progress", tone: "text-info", value: stats.inProgress },
    { label: "Complete", tone: "text-success", value: stats.complete },
    {
      label: "Needs a human",
      tone: "text-destructive",
      value: stats.needsHuman,
    },
    {
      label: "Waiting on the AE",
      tone: "text-amber-600 dark:text-amber-400",
      value: stats.awaitingAe,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <Card className="gap-1 py-3" key={card.label}>
          <CardHeader className="px-4 pb-0">
            <CardTitle className="font-medium text-muted-foreground text-xs">
              {card.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className={`font-bold text-2xl tabular-nums ${card.tone}`}>
              {card.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DealsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton className="h-20" key={i} />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
