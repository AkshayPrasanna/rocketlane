"use client";

/** Formats in the viewer's own time zone; the server would use its own (UTC on Vercel). */
export function LocalTime({
  iso,
  withDate = false,
}: {
  iso: string;
  withDate?: boolean;
}) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning title={date.toLocaleString()}>
      {withDate
        ? date.toLocaleString(undefined, {
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            month: "short",
            second: "2-digit",
          })
        : date.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
    </time>
  );
}
