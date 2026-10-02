import { Info } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/deals/auto-refresh";
import { Header } from "@/components/header";
import { LocalTime } from "@/components/local-time";
import { SlackText } from "@/components/slack-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/lib/admin-session";
import { getDashboardQueries } from "@/lib/dashboard/get-queries";
import { maskEmail } from "@/lib/domain/mask";
import { cn } from "@/lib/utils";

export default function SlackPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  return (
    <>
      <Header
        description="What the Communication agent posts, as Slack would show it"
        title="Slack (simulated)"
      />
      <div className="flex-1 space-y-4 p-4">
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p>
            Slack is simulated in this demo. The agent creates the channel, sets
            its topic, posts the welcome message and "invites" the customer
            exactly as it would in production, but everything is recorded here
            instead of sent. Production uses the Slack Web API, and the customer
            invite becomes a real Slack Connect invitation (paid plan).
          </p>
        </div>
        <AutoRefresh />
        <Suspense fallback={<Skeleton className="h-96" />}>
          <SlackContent searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function SlackContent({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  await requireAdmin();
  const { channel: wanted } = await searchParams;
  const channels = await getDashboardQueries().slackChannels();

  if (channels.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground text-sm">
          No channels yet. They appear as deals reach the Slack step, and the
          ops alert channel appears with the first escalation.
        </CardContent>
      </Card>
    );
  }

  const selected =
    channels.find((view) => view.channel.channelId === wanted) ?? channels[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Channels" className="space-y-1">
        {channels.map(({ channel }) => (
          <Link
            className={cn(
              "block truncate rounded-md px-3 py-2 text-sm hover:bg-accent",
              channel.channelId === selected.channel.channelId &&
                "bg-accent font-medium"
            )}
            href={`/slack?channel=${channel.channelId}`}
            key={channel.channelId}
          >
            # {channel.name}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader className="border-b">
          <CardTitle># {selected.channel.name}</CardTitle>
          {selected.channel.topic && (
            <p className="text-muted-foreground text-sm">
              <span className="font-medium text-foreground">Topic:</span>{" "}
              {selected.channel.topic}
            </p>
          )}
          {selected.channel.purpose && (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">Purpose:</span>{" "}
              {selected.channel.purpose}
            </p>
          )}
          {selected.invites.map((invite) => (
            <p
              className="text-muted-foreground text-xs"
              key={invite.email + invite.invitedAt}
            >
              Slack Connect invite (simulated) to {maskEmail(invite.email)}
            </p>
          ))}
        </CardHeader>
        <CardContent className="space-y-4">
          {selected.messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">No messages yet.</p>
          ) : (
            selected.messages.map((message) => (
              <div className="flex gap-3" key={message.ts}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-xs">
                  NO
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">NovaCRM Onboarding</span>{" "}
                    <span className="text-muted-foreground text-xs">
                      <LocalTime iso={message.postedAt} />
                    </span>
                  </p>
                  <SlackText text={message.text} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
