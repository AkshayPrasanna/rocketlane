"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the page's server data on a timer, only while the tab is visible. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);

  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
      Live: updates every {Math.round(intervalMs / 1000)}s
    </p>
  );
}
