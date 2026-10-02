"use client";

import { TrendingUp } from "lucide-react";
import { use } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsData } from "@/lib/types";

const STACK_ORDER = [
  "flagged",
  "surfaced",
  "welcomed",
  "routed",
  "answered",
] as const;

const COLORS: Record<string, string> = {
  answered: "var(--type-answered)",
  routed: "var(--type-routed)",
  welcomed: "var(--type-welcomed)",
  surfaced: "var(--type-surfaced)",
  flagged: "var(--type-flagged)",
};

const LABELS: Record<string, string> = {
  answered: "Answered",
  routed: "Routed",
  welcomed: "Welcomed",
  surfaced: "Surfaced",
  flagged: "Flagged",
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!(active && payload?.length)) {
    return null;
  }

  const total = payload.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((entry) => (
          <div className="flex items-center gap-2 text-xs" key={entry.dataKey}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            {LABELS[entry.dataKey]}: {entry.value}
          </div>
        ))}
      <div className="mt-1 border-t pt-1 font-medium text-xs">
        Total: {total}
      </div>
    </div>
  );
}

export function AnalyticsChart({
  dataPromise,
}: {
  dataPromise: Promise<AnalyticsData>;
}) {
  const { buckets: data } = use(dataPromise);
  const hasData = data.some(
    (d) => d.answered + d.routed + d.welcomed + d.surfaced + d.flagged > 0
  );

  const days = data.length;
  const subtitle = days <= 1 ? "Today" : `Last ${days} days`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Activity trend</CardTitle>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div>
            <ResponsiveContainer height={240} width="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              >
                <defs>
                  {Object.entries(COLORS).map(([key, color]) => (
                    <linearGradient
                      id={`grad-${key}`}
                      key={key}
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                      <stop
                        offset="100%"
                        stopColor={color}
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  className="stroke-border"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  className="fill-muted-foreground"
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  className="fill-muted-foreground"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                {STACK_ORDER.map((key) => (
                  <Area
                    dataKey={key}
                    fill={`url(#grad-${key})`}
                    key={key}
                    stackId="actions"
                    stroke={COLORS[key]}
                    strokeWidth={1.5}
                    type="monotone"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {STACK_ORDER.toReversed().map((key) => (
                <div
                  className="flex items-center gap-1.5 text-muted-foreground text-xs"
                  key={key}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ backgroundColor: COLORS[key] }}
                  />
                  {LABELS[key]}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground text-sm">
              No activity recorded yet. The chart will populate as the bot
              handles messages.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
