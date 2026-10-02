"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useActiveStreams } from "./active-streams-context";

export function ActivityCardGlow({
  threadKey,
  children,
}: {
  threadKey?: string;
  children: ReactNode;
}) {
  const { activeThreadKeys } = useActiveStreams();
  const isActive = threadKey ? activeThreadKeys.includes(threadKey) : false;

  if (!isActive) {
    return children;
  }

  return (
    <div className="relative rounded-xl ring-2 ring-success/40 [&_[data-slot=card]]:border-transparent [&_[data-slot=card]]:bg-success/5">
      {children}
      <div className="absolute top-2 right-3 flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
        <Loader2 className="h-3 w-3 animate-spin" />
        Responding
      </div>
    </div>
  );
}
