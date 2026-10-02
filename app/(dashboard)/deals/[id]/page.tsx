import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuditTimeline } from "@/components/deals/audit-timeline";
import { AutoRefresh } from "@/components/deals/auto-refresh";
import { StateBadge, TierBadge, ToneBadge } from "@/components/deals/badges";
import { ProgressStepper } from "@/components/deals/progress-stepper";
import { Header } from "@/components/header";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/admin-session";
import { getDashboardQueries } from "@/lib/dashboard/get-queries";
import { REASON_LABELS } from "@/lib/dashboard/labels";
import { customerLabel } from "@/lib/dashboard/queries";
import { buildProgress, STATE_META } from "@/lib/dashboard/state-meta";
import { maskEmail } from "@/lib/domain/mask";

export default function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <DealContent params={params} />
    </Suspense>
  );
}

function Field({
  label,
  children,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

async function DealContent({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getDashboardQueries().dealDetail(id);
  if (!detail) {
    notFound();
  }
  const { audit, channel, deal, escalations, messages } = detail;
  const parsed = deal.parsed;

  return (
    <>
      <Header
        description={STATE_META[deal.state].hint}
        title={customerLabel(deal)}
      />
      <div className="flex-1 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link href="/">
              <ArrowLeft /> All deals
            </Link>
          </Button>
          <StateBadge state={deal.state} />
          <TierBadge tier={deal.planTier} />
          <AutoRefresh />
          <Button asChild className="ml-auto" size="sm" variant="outline">
            <a download href={`/api/audit/export?dealId=${deal.dealId}`}>
              <Download /> Export this deal's audit log
            </a>
          </Button>
        </div>

        <Card>
          <CardContent>
            <ProgressStepper steps={buildProgress(deal)} />
          </CardContent>
        </Card>

        {escalations.map((escalation) => (
          <Card
            className="border-destructive/40 bg-destructive/5"
            key={escalation.id}
          >
            <CardContent className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={escalation.resolvedAt ? "neutral" : "danger"}>
                  {escalation.resolvedAt ? "Resolved" : "Needs a human"}
                </ToneBadge>
                <span className="font-medium text-sm">
                  {REASON_LABELS[escalation.reason]}
                </span>
                <Link
                  className="ml-auto text-info text-sm hover:underline"
                  href="/escalations"
                >
                  Open the queue
                </Link>
              </div>
              <p className="text-sm">{escalation.detail}</p>
            </CardContent>
          </Card>
        ))}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Deal</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label="Customer">{parsed?.customerName ?? "-"}</Field>
                  <Field label="Contact">
                    {parsed?.customerContactName ?? "-"}
                    {parsed?.customerContactEmail && (
                      <span className="block text-muted-foreground text-xs">
                        {maskEmail(parsed.customerContactEmail)}
                      </span>
                    )}
                  </Field>
                  <Field label="AE">
                    {parsed?.aeName ?? "-"}
                    <span className="block text-muted-foreground text-xs">
                      {maskEmail(deal.aeEmail ?? "")}
                    </span>
                  </Field>
                  <Field label="Salesforce">
                    {parsed?.salesforceOpportunityUrl ? (
                      <a
                        className="text-info hover:underline"
                        href={parsed.salesforceOpportunityUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {parsed.opportunityId ?? "Open"}
                      </a>
                    ) : (
                      "-"
                    )}
                  </Field>
                  <Field label="Call attempts">{deal.callAttempts}</Field>
                  <Field label="Received">
                    <LocalTime iso={deal.createdAt} withDate />
                  </Field>
                  {deal.missingFields.length > 0 && (
                    <Field label="Missing">
                      {deal.missingFields.join(", ")}
                    </Field>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">What was created</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label="Rocketlane project">
                    {deal.project ? (
                      <>
                        {deal.project.projectUrl ? (
                          <a
                            className="text-info hover:underline"
                            href={deal.project.projectUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {deal.project.projectId}
                          </a>
                        ) : (
                          deal.project.projectId
                        )}
                        <span className="block text-muted-foreground text-xs">
                          {deal.project.templateName}
                        </span>
                        <span className="block text-muted-foreground text-xs">
                          {deal.project.startDate} to {deal.project.dueDate}
                        </span>
                      </>
                    ) : (
                      "-"
                    )}
                  </Field>
                  <Field label="Slack channel (simulated)">
                    {channel ? (
                      <Link
                        className="text-info hover:underline"
                        href={`/slack?channel=${channel.channelId}`}
                      >
                        #{channel.name}
                      </Link>
                    ) : (
                      "-"
                    )}
                    {channel?.topic && (
                      <span className="block text-muted-foreground text-xs">
                        {channel.topic}
                      </span>
                    )}
                    {messages.length > 0 && (
                      <span className="block text-muted-foreground text-xs">
                        {messages.length} message
                        {messages.length === 1 ? "" : "s"} posted
                      </span>
                    )}
                  </Field>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">
                Timeline: every agent action, with the reasoning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AuditTimeline entries={audit} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
