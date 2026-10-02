"use client";

import { Bot, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useStream } from "@/hooks/use-streams";

export function LiveStreamIndicator({ threadKey }: { threadKey: string }) {
  const { data: stream } = useStream(threadKey);
  const router = useRouter();
  const wasLive = useRef(false);

  useEffect(() => {
    if (stream) {
      wasLive.current = true;
    } else if (wasLive.current) {
      wasLive.current = false;
      router.refresh();
    }
  }, [stream, router]);

  if (!stream) {
    return null;
  }

  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10">
        <Bot className="h-3.5 w-3.5 text-success" />
      </div>
      <Card className="max-w-[75%] gap-0 border-success/20 bg-success/5 py-0">
        <CardContent className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground text-sm">
          <Loader2 className="h-3 w-3 animate-spin text-success" />
          Bot is responding&hellip;
        </CardContent>
      </Card>
    </div>
  );
}
