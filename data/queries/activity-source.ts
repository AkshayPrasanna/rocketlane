import { mockActions, mockConversations } from "@/data/mock/activity";
import { config } from "@/lib/config";
import {
  type ActionStats,
  getLastSeen,
  getThreadKeyForAction as getStoreThreadKeyForAction,
  isStoreConfigured,
  getActionById as storeGetActionById,
  getConversation as storeGetConversation,
  getRecentActions as storeGetRecentActions,
  getStats as storeGetStats,
} from "@/lib/store";
import type { BotAction, ConversationMessage } from "@/lib/types";

const LEADING_HASH_RE = /^#/;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getMockActions(): BotAction[] {
  return [...mockActions].sort(
    (a, b) => (b.lastUpdated ?? b.timestamp) - (a.lastUpdated ?? a.timestamp)
  );
}

function countActions(actions: BotAction[]): ActionStats {
  const counts: ActionStats = {
    answered: 0,
    flagged: 0,
    routed: 0,
    surfaced: 0,
    total: actions.length,
    welcomed: 0,
  };

  for (const action of actions) {
    counts[action.type] += 1;
  }

  return counts;
}

function countChannels(actions: BotAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) {
    if (action.channel) {
      const name = action.channel.replace(LEADING_HASH_RE, "");
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  return counts;
}

export function shouldUseMockActivity(): boolean {
  return config.adminDemoMode || !isStoreConfigured();
}

export async function getActivityActions(): Promise<BotAction[]> {
  if (shouldUseMockActivity()) {
    if (!config.adminDemoMode) {
      await delay(2000);
    }
    return getMockActions();
  }

  return storeGetRecentActions(500);
}

export async function getActivityActionById(
  id: string
): Promise<BotAction | null> {
  if (shouldUseMockActivity()) {
    if (!config.adminDemoMode) {
      await delay(500);
    }
    return mockActions.find((a) => a.id === id) ?? null;
  }

  return storeGetActionById(id);
}

export async function getActivityConversation(
  actionId: string
): Promise<ConversationMessage[]> {
  if (shouldUseMockActivity()) {
    if (!config.adminDemoMode) {
      await delay(500);
    }
    return mockConversations[actionId] || [];
  }

  return storeGetConversation(actionId);
}

export async function getActivityStats(): Promise<ActionStats> {
  if (shouldUseMockActivity()) {
    return countActions(getMockActions());
  }

  return await storeGetStats();
}

export async function getActivityChannelCounts(): Promise<
  Record<string, number>
> {
  if (shouldUseMockActivity()) {
    return countChannels(mockActions);
  }

  return countChannels(await storeGetRecentActions(500));
}

export async function getActivityLastSeen(userId: string): Promise<number> {
  if (config.adminDemoMode) {
    return 0;
  }

  return await getLastSeen(userId);
}

export async function getActivityThreadKey(
  actionId: string
): Promise<string | null> {
  if (shouldUseMockActivity()) {
    return null;
  }

  return await getStoreThreadKeyForAction(actionId);
}
