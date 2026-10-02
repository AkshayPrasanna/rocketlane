"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

interface ActiveStreamsContextValue {
  activeThreadKeys: string[];
  setActiveThreadKeys: (keys: string[]) => void;
}

const ActiveStreamsContext = createContext<ActiveStreamsContextValue>({
  activeThreadKeys: [],
  setActiveThreadKeys: () => {
    /* noop */
  },
});

export function ActiveStreamsProvider({ children }: { children: ReactNode }) {
  const [activeThreadKeys, setActiveThreadKeys] = useState<string[]>([]);
  const value = useMemo(
    () => ({ activeThreadKeys, setActiveThreadKeys }),
    [activeThreadKeys]
  );
  return <ActiveStreamsContext value={value}>{children}</ActiveStreamsContext>;
}

export function useActiveStreams() {
  return useContext(ActiveStreamsContext);
}
