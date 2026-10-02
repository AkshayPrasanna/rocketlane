"use client";

import { Loader2, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, ViewTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveStreams as useActiveStreamsSWR } from "@/hooks/use-streams";
import { cn } from "@/lib/utils";
import { useActiveStreams } from "./active-streams-context";

export function ActiveStreams() {
  const { data: streams } = useActiveStreamsSWR();
  const { setActiveThreadKeys } = useActiveStreams();
  const router = useRouter();
  const prevStreamIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!streams) {
      return;
    }

    setActiveThreadKeys(
      streams.filter((e) => e.isFollowUp).map((e) => e.threadId)
    );

    const currentIds = new Set(streams.map((s) => s.threadId));
    const hadStreams = prevStreamIds.current.size > 0;
    const streamEnded =
      hadStreams &&
      [...prevStreamIds.current].some((id) => !currentIds.has(id));
    prevStreamIds.current = currentIds;

    if (streamEnded) {
      router.refresh();
    }
  }, [streams, setActiveThreadKeys, router]);

  const newStreams = (streams ?? []).filter((s) => !s.isFollowUp);
  const isActive = newStreams.length > 0;

  return (
    <ViewTransition>
      <Card
        className={cn(
          "gap-0 py-0",
          isActive ? "border-success/20 bg-success/5" : "border-dashed"
        )}
      >
        <CardContent className="flex items-center gap-2.5 py-2">
          <div
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              isActive ? "bg-success/10" : "bg-muted"
            )}
          >
            {isActive ? (
              <Loader2 className="h-3 w-3 animate-spin text-success" />
            ) : (
              <Radio className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn("text-xs", !isActive && "text-muted-foreground")}>
              {(() => {
                if (!isActive) {
                  return "Bot is idle";
                }
                if (newStreams.length > 1) {
                  return `Bot is responding to ${newStreams.length} conversations\u2026`;
                }
                return `Bot is responding in ${newStreams[0].channel}\u2026`;
              })()}
            </p>
          </div>
          <Badge
            className={
              isActive
                ? "shrink-0 border-success/30 text-success"
                : "shrink-0 text-muted-foreground"
            }
            variant="outline"
          >
            {isActive ? "Active" : "Idle"}
          </Badge>
        </CardContent>
      </Card>
    </ViewTransition>
  );
}
