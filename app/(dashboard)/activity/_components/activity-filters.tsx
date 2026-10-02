"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { use, useOptimistic, useTransition } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const filters = [
  { value: "all", label: "All", color: null },
  { value: "answered", label: "Answered", color: "bg-type-answered" },
  { value: "routed", label: "Routed", color: "bg-type-routed" },
  { value: "welcomed", label: "Welcomed", color: "bg-type-welcomed" },
  { value: "surfaced", label: "Surfaced", color: "bg-type-surfaced" },
  { value: "flagged", label: "Flagged", color: "bg-type-flagged" },
] as const;

interface ActivityFiltersProps {
  countsPromise: Promise<Record<string, number>>;
}

export function ActivityFilters({ countsPromise }: ActivityFiltersProps) {
  const counts = use(countsPromise);
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentType = searchParams.get("type") || "all";
  const [optimisticType, setOptimisticType] = useOptimistic(currentType);
  const [isPending, startTransition] = useTransition();

  function handleValueChange(value: string) {
    if (!value) {
      return;
    }
    startTransition(() => {
      setOptimisticType(value);
      const params = new URLSearchParams(searchParams);
      if (value === "all") {
        params.delete("type");
      } else {
        params.set("type", value);
      }
      params.delete("limit");
      const query = params.toString();
      router.push(query ? `/activity?${query}` : "/activity");
    });
  }

  return (
    <ToggleGroup
      className="flex-wrap"
      data-pending={isPending ? "" : undefined}
      onValueChange={handleValueChange}
      size="sm"
      spacing={1}
      type="single"
      value={optimisticType}
      variant="outline"
    >
      {filters.map((filter) => {
        const count = counts?.[filter.value];
        const isActive = optimisticType === filter.value;
        return (
          <ToggleGroupItem
            className={cn(
              "gap-1.5 text-xs",
              isActive &&
                "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
            )}
            key={filter.value}
            value={filter.value}
          >
            {filter.color && (
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  filter.color,
                  isActive && "opacity-70"
                )}
              />
            )}
            {filter.label}
            {count !== undefined && (
              <span className={cn("tabular-nums opacity-60")}>{count}</span>
            )}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
