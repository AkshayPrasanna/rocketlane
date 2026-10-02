import useSWR from "swr";
import type { StreamEntry } from "@/lib/types";

export type AnnotatedStream = StreamEntry & { isFollowUp: boolean };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useActiveStreams() {
  return useSWR<AnnotatedStream[]>("/api/streams", fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
}

export function useStream(threadKey: string) {
  return useSWR<StreamEntry | null>(`/api/streams/${threadKey}`, fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
}
