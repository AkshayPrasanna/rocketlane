"use client";

import { Loader2, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useActiveStreams } from "@/hooks/use-streams";
import { cn } from "@/lib/utils";

export function DashboardLive() {
  const { data: streams } = useActiveStreams();
  const router = useRouter();
  const prevCount = useRef(0);
  const count = streams?.length ?? 0;

  useEffect(() => {
    if (prevCount.current > 0 && count < prevCount.current) {
      router.refresh();
    }
    prevCount.current = count;
  }, [count, router]);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
        count > 0
          ? "border-success/20 bg-success/5"
          : "border-dashed text-muted-foreground"
      )}
    >
      <Radio
        className={cn(
          "h-3.5 w-3.5",
          count > 0 ? "animate-pulse text-success" : "text-muted-foreground"
        )}
      />
      {count > 0 ? (
        <span>
          Bot is handling{" "}
          <span className="font-medium text-success">
            {count} {count === 1 ? "conversation" : "conversations"}
          </span>
        </span>
      ) : (
        <span>Bot is idle</span>
      )}
      {count > 0 && (
        <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-success" />
      )}
    </div>
  );
}
