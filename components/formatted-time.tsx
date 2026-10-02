"use client";

import { useEffect, useState } from "react";

interface FormattedTimeProps {
  timestamp: number;
}

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getRefreshInterval(timestamp: number): number {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) {
    return 10_000;
  }
  if (diff < 3_600_000) {
    return 60_000;
  }
  return 300_000;
}

export function FormattedTime({ timestamp }: FormattedTimeProps) {
  const [relative, setRelative] = useState(() => getRelativeTime(timestamp));

  useEffect(() => {
    const id = setInterval(() => {
      setRelative(getRelativeTime(timestamp));
    }, getRefreshInterval(timestamp));
    return () => clearInterval(id);
  }, [timestamp]);

  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      suppressHydrationWarning
      title={new Date(timestamp).toLocaleString()}
    >
      {relative}
    </time>
  );
}
