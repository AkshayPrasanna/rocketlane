"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";
import { Input } from "@/components/ui/input";

export function ActivitySearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function handleChange(value: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams);
        if (value.trim()) {
          params.set("q", value.trim());
        } else {
          params.delete("q");
        }
        params.delete("limit");
        const query = params.toString();
        router.push(query ? `/activity?${query}` : "/activity");
      });
    }, 300);
  }

  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <label className="sr-only" htmlFor="activity-search">
        Search activity
      </label>
      <Input
        className="h-8 pl-9 text-xs"
        defaultValue={searchParams.get("q") || ""}
        id="activity-search"
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search activity..."
        type="search"
      />
    </div>
  );
}
