import { cache } from "react";
import { isCurrentUserLead } from "@/lib/auth";
import type {
  AnalyticsBucket,
  AnalyticsData,
  BotAction,
  ConversationDetail,
  ConversationMessage,
  DashboardStats,
} from "@/lib/types";
import {
  getActivityActionById,
  getActivityActions,
  getActivityChannelCounts,
  getActivityConversation,
  getActivityLastSeen,
  getActivityStats,
  getActivityThreadKey,
} from "./activity-source";
import { getCurrentSession, requireSession } from "./auth";

export const getRecentActions = cache(async (): Promise<BotAction[]> => {
  await requireSession();
  return getActivityActions();
});

export const getActionById = cache(
  async (id: string): Promise<BotAction | null> => {
    await requireSession();
    return getActivityActionById(id);
  }
);

export const getConversation = cache(
  async (actionId: string): Promise<ConversationMessage[]> => {
    await requireSession();
    return getActivityConversation(actionId);
  }
);

export const getConversationDetail = cache(
  async (actionId: string): Promise<ConversationDetail | null> => {
    await requireSession();

    const action = await getActionById(actionId);
    if (!action) {
      return null;
    }

    const isDM = action.channel === "DM";
    const [canViewDM, threadKey] = await Promise.all([
      isDM ? isCurrentUserLead() : true,
      getActivityThreadKey(actionId),
    ]);

    const messages = canViewDM ? await getConversation(actionId) : [];

    return { action, messages, threadKey, dmRestricted: isDM && !canViewDM };
  }
);

async function fetchAnalyticsData(): Promise<AnalyticsData> {
  const actions = await getActivityActions();

  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  function startOfDay(ts: number) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const todayStart = startOfDay(now);
  const earliest =
    actions.length > 0 ? Math.min(...actions.map((a) => a.timestamp)) : now;
  const earliestDayStart = startOfDay(earliest);
  const spanDays = Math.max(
    Math.round((todayStart - earliestDayStart) / dayMs) + 1,
    2
  );

  const buckets: AnalyticsBucket[] = [];

  for (let i = 0; i < spanDays; i++) {
    const d = new Date(earliestDayStart + i * dayMs);
    buckets.push({
      date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      answered: 0,
      routed: 0,
      welcomed: 0,
      surfaced: 0,
      flagged: 0,
    });
  }

  const typeCounts: Record<string, number> = {};

  for (const action of actions) {
    typeCounts[action.type] = (typeCounts[action.type] || 0) + 1;

    const actionDayStart = startOfDay(action.timestamp);
    const idx = Math.round((actionDayStart - earliestDayStart) / dayMs);
    if (idx >= 0 && idx < spanDays) {
      buckets[idx][action.type]++;
    }
  }

  return { buckets, typeCounts, totalActions: actions.length };
}

export const getAnalyticsData = cache(async (): Promise<AnalyticsData> => {
  await requireSession();
  return fetchAnalyticsData();
});

export const getDashboardStats = cache(async (): Promise<DashboardStats> => {
  const actions = await getRecentActions();
  const stats = await getActivityStats();

  const counts: Record<string, number> = { ...stats };
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek: Record<string, number> = { total: 0 };

  for (const action of actions) {
    if (action.timestamp >= weekAgo) {
      thisWeek[action.type] = (thisWeek[action.type] || 0) + 1;
      thisWeek.total++;
    }
  }

  return { counts, thisWeek };
});

export const getActionCounts = cache(
  async (): Promise<Record<string, number>> => {
    await requireSession();
    const stats = await getActivityStats();
    return {
      all: stats.total,
      answered: stats.answered,
      routed: stats.routed,
      welcomed: stats.welcomed,
      surfaced: stats.surfaced,
      flagged: stats.flagged,
    };
  }
);

export const getChannelCounts = cache(
  async (): Promise<Record<string, number>> => {
    await requireSession();
    return getActivityChannelCounts();
  }
);

export const getLastSeenTimestamp = cache(async (): Promise<number> => {
  const session = await getCurrentSession().catch(() => null);
  if (!session?.user?.id) {
    return 0;
  }
  return getActivityLastSeen(session.user.id);
});
