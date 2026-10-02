"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

interface ShowMoreButtonProps {
  currentCount: number;
  pageSize?: number;
  totalCount: number;
}

export function ShowMoreButton({
  totalCount,
  currentCount,
  pageSize = 20,
}: ShowMoreButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (currentCount >= totalCount) {
    return null;
  }

  function handleShowMore() {
    startTransition(() => {
      const params = new URLSearchParams(searchParams);
      params.set("limit", String(currentCount + pageSize));
      router.push(`/activity?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex justify-center pt-2">
      <Button
        disabled={isPending}
        onClick={handleShowMore}
        size="sm"
        variant="outline"
      >
        {isPending
          ? "Loading..."
          : `Show more (${totalCount - currentCount} remaining)`}
      </Button>
    </div>
  );
}
