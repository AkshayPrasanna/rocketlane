import { Redis } from "@upstash/redis";
import { createLogger } from "./logger";
import type { BotAction, ConversationMessage, StreamEntry } from "./types";

const logger = createLogger("store");

let redis: Redis | null = null;

function getRedisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!(url && token)) {
    return null;
  }
  return { url, token };
}

function getRedis(): Redis | null {
  if (redis) {
    return redis;
  }

  const creds = getRedisCredentials();
  if (!creds) {
    return null;
  }

  redis = new Redis(creds);
  return redis;
}

export function isStoreConfigured(): boolean {
  return getRedisCredentials() !== null;
}

const ACTIONS_KEY = "bot:actions";
const ACTIONS_INDEX_PREFIX = "bot:action:";
const STATS_KEY = "bot:stats";
const CONVERSATIONS_PREFIX = "bot:conv:";
const THREAD_ACTION_PREFIX = "bot:thread:";
const ACTION_THREAD_PREFIX = "bot:action-thread:";
const LASTSEEN_PREFIX = "bot:lastseen:";
const STREAM_PREFIX = "bot:stream:";
const STATUS_CTX_PREFIX = "bot:status-ctx:";
const TTL_30_DAYS = 60 * 60 * 24 * 30;
const TTL_STREAM = 120;
const TTL_STATUS_CTX = 300;

function parseEntry<T>(entry: string | T): T {
  return typeof entry === "string" ? JSON.parse(entry) : entry;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function logAction(
  action: Omit<BotAction, "id" | "timestamp">,
  conversation?: ConversationMessage[],
  threadKey?: string
): Promise<string | undefined> {
  const client = getRedis();
  if (!client) {
    return;
  }

  if (threadKey) {
    const existingActionId = await client.get<string>(
      `${THREAD_ACTION_PREFIX}${threadKey}`
    );
    if (existingActionId) {
      return updateConversation(existingActionId, conversation);
    }
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const entry: BotAction = {
    ...action,
    id,
    timestamp: Date.now(),
    ...(threadKey ? { threadKey } : {}),
  };

  try {
    const entryJson = JSON.stringify(entry);
    const ops: Promise<unknown>[] = [
      client.zadd(ACTIONS_KEY, { score: entry.timestamp, member: entryJson }),
      client.set(`${ACTIONS_INDEX_PREFIX}${id}`, entryJson, {
        ex: TTL_30_DAYS,
      }),
      client.hincrby(STATS_KEY, entry.type, 1),
      client.hincrby(STATS_KEY, "total", 1),
    ];

    if (conversation && conversation.length > 0) {
      ops.push(
        client.set(
          `${CONVERSATIONS_PREFIX}${id}`,
          JSON.stringify(conversation),
          {
            ex: TTL_30_DAYS,
          }
        )
      );
    }

    if (threadKey) {
      ops.push(
        client.set(`${THREAD_ACTION_PREFIX}${threadKey}`, id, {
          ex: TTL_30_DAYS,
        }),
        client.set(`${ACTION_THREAD_PREFIX}${id}`, threadKey, {
          ex: TTL_30_DAYS,
        })
      );
    }

    await Promise.all(ops);
    return id;
  } catch (error) {
    logger.error("Failed to log action", { error: safeErrorMessage(error) });
    return;
  }
}

async function updateConversation(
  actionId: string,
  conversation?: ConversationMessage[]
): Promise<string | undefined> {
  const client = getRedis();
  if (!(client && conversation?.length)) {
    return actionId;
  }

  try {
    const now = Date.now();

    const existing = await client.get<string>(
      `${ACTIONS_INDEX_PREFIX}${actionId}`
    );
    if (existing) {
      const action = parseEntry<BotAction>(existing);
      const updated = { ...action, lastUpdated: now };
      const updatedJson = JSON.stringify(updated);
      await client.zrem(ACTIONS_KEY, JSON.stringify(action));
      await Promise.all([
        client.zadd(ACTIONS_KEY, { score: now, member: updatedJson }),
        client.set(`${ACTIONS_INDEX_PREFIX}${actionId}`, updatedJson, {
          ex: TTL_30_DAYS,
        }),
      ]);
    }

    await client.set(
      `${CONVERSATIONS_PREFIX}${actionId}`,
      JSON.stringify(conversation),
      {
        ex: TTL_30_DAYS,
      }
    );
    return actionId;
  } catch (error) {
    logger.error("Failed to update conversation", {
      error: safeErrorMessage(error),
    });
    return actionId;
  }
}

export async function appendToConversation(
  threadKey: string,
  messages: ConversationMessage[]
): Promise<void> {
  const client = getRedis();
  if (!client || messages.length === 0) {
    return;
  }

  try {
    const actionId = await client.get<string>(
      `${THREAD_ACTION_PREFIX}${threadKey}`
    );
    if (!actionId) {
      return;
    }

    const raw = await client.get<string>(`${CONVERSATIONS_PREFIX}${actionId}`);
    const existing = raw ? parseEntry<ConversationMessage[]>(raw) : [];
    const updated = [...existing, ...messages];
    await client.set(
      `${CONVERSATIONS_PREFIX}${actionId}`,
      JSON.stringify(updated),
      {
        ex: TTL_30_DAYS,
      }
    );
  } catch (error) {
    logger.error("Failed to append to conversation", {
      error: safeErrorMessage(error),
    });
  }
}

export async function getConversation(
  actionId: string
): Promise<ConversationMessage[]> {
  const client = getRedis();
  if (!client) {
    return [];
  }

  try {
    const raw = await client.get<string>(`${CONVERSATIONS_PREFIX}${actionId}`);
    if (!raw) {
      return [];
    }
    return parseEntry<ConversationMessage[]>(raw);
  } catch (error) {
    logger.error("Failed to get conversation", {
      error: safeErrorMessage(error),
    });
    return [];
  }
}

export async function getRecentActions(limit = 50): Promise<BotAction[]> {
  const client = getRedis();
  if (!client) {
    return [];
  }

  try {
    const raw = await client.zrange<string[]>(ACTIONS_KEY, 0, limit - 1, {
      rev: true,
    });
    return raw.map((entry) => parseEntry<BotAction>(entry));
  } catch (error) {
    logger.error("Failed to get recent actions", {
      error: safeErrorMessage(error),
    });
    return [];
  }
}

export interface ActionStats {
  answered: number;
  flagged: number;
  routed: number;
  surfaced: number;
  total: number;
  welcomed: number;
}

async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [nextCursor, batch] = await client.scan(cursor, {
      match: pattern,
      count: 100,
    });
    cursor = Number(nextCursor);
    keys.push(...batch);
  } while (cursor !== 0);
  return keys;
}

export async function clearAllActions(): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }

  try {
    const [convKeys, threadKeys, indexKeys, reverseKeys] = await Promise.all([
      scanKeys(client, `${CONVERSATIONS_PREFIX}*`),
      scanKeys(client, `${THREAD_ACTION_PREFIX}*`),
      scanKeys(client, `${ACTIONS_INDEX_PREFIX}*`),
      scanKeys(client, `${ACTION_THREAD_PREFIX}*`),
    ]);
    const allKeys = [
      ACTIONS_KEY,
      STATS_KEY,
      ...convKeys,
      ...threadKeys,
      ...indexKeys,
      ...reverseKeys,
    ];
    if (allKeys.length > 0) {
      await client.del(...allKeys);
    }
  } catch (error) {
    logger.error("Failed to clear actions", { error: safeErrorMessage(error) });
  }
}

export async function getActionById(id: string): Promise<BotAction | null> {
  const client = getRedis();
  if (!client) {
    return null;
  }

  try {
    const indexed = await client.get<string>(`${ACTIONS_INDEX_PREFIX}${id}`);
    if (indexed) {
      return parseEntry<BotAction>(indexed);
    }

    // Fallback for actions logged before the index was introduced
    const raw = await client.zrange<string[]>(ACTIONS_KEY, 0, -1, {
      rev: true,
    });
    for (const entry of raw) {
      const action = parseEntry<BotAction>(entry);
      if (action.id === id) {
        await client.set(
          `${ACTIONS_INDEX_PREFIX}${id}`,
          JSON.stringify(action),
          {
            ex: TTL_30_DAYS,
          }
        );
        return action;
      }
    }
    return null;
  } catch (error) {
    logger.error("Failed to get action by id", {
      error: safeErrorMessage(error),
    });
    return null;
  }
}

export async function getLastSeen(userId: string): Promise<number> {
  const client = getRedis();
  if (!client) {
    return 0;
  }

  try {
    const ts = await client.get<number>(`${LASTSEEN_PREFIX}${userId}`);
    return ts ?? 0;
  } catch (error) {
    logger.error("Failed to get last seen", { error: safeErrorMessage(error) });
    return 0;
  }
}

export async function setLastSeen(
  userId: string,
  timestamp: number
): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }

  try {
    await client.set(`${LASTSEEN_PREFIX}${userId}`, timestamp);
  } catch (error) {
    logger.error("Failed to set last seen", { error: safeErrorMessage(error) });
  }
}

export async function getStats(): Promise<ActionStats> {
  const client = getRedis();
  if (!client) {
    return {
      routed: 0,
      welcomed: 0,
      surfaced: 0,
      answered: 0,
      flagged: 0,
      total: 0,
    };
  }

  try {
    const raw = await client.hgetall<Record<string, string>>(STATS_KEY);
    if (!raw) {
      return {
        routed: 0,
        welcomed: 0,
        surfaced: 0,
        answered: 0,
        flagged: 0,
        total: 0,
      };
    }

    return {
      routed: Number(raw.routed || 0),
      welcomed: Number(raw.welcomed || 0),
      surfaced: Number(raw.surfaced || 0),
      answered: Number(raw.answered || 0),
      flagged: Number(raw.flagged || 0),
      total: Number(raw.total || 0),
    };
  } catch (error) {
    logger.error("Failed to get stats", { error: safeErrorMessage(error) });
    return {
      routed: 0,
      welcomed: 0,
      surfaced: 0,
      answered: 0,
      flagged: 0,
      total: 0,
    };
  }
}

export async function writeStreamEntry(entry: StreamEntry): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }

  try {
    await client.set(
      `${STREAM_PREFIX}${entry.threadId}`,
      JSON.stringify(entry),
      {
        ex: TTL_STREAM,
      }
    );
  } catch (error) {
    logger.error("Failed to write stream entry", {
      error: safeErrorMessage(error),
    });
  }
}

/*
 * Single global key for the active Slack thread context. Each workflow writes here
 * at start so tool steps can read it back (steps run in isolated serverless contexts
 * and can't share module-level state). Trade-off: concurrent workflows overwrite each
 * other's context, which can briefly show the wrong status text — cosmetic only.
 */
const ACTIVE_STATUS_KEY = `${STATUS_CTX_PREFIX}active`;

export async function saveStatusContext(
  channelId: string,
  threadTs: string
): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }
  try {
    await client.set(
      ACTIVE_STATUS_KEY,
      JSON.stringify({ channelId, threadTs }),
      { ex: TTL_STATUS_CTX }
    );
  } catch (error) {
    logger.error("Failed to save status context", {
      error: safeErrorMessage(error),
    });
  }
}

export async function getActiveStatusContext(): Promise<{
  channelId: string;
  threadTs: string;
} | null> {
  const client = getRedis();
  if (!client) {
    return null;
  }
  try {
    const raw = await client.get<string>(ACTIVE_STATUS_KEY);
    if (!raw) {
      return null;
    }
    return parseEntry<{ channelId: string; threadTs: string }>(raw);
  } catch {
    return null;
  }
}

export async function clearStatusContext(
  channelId: string,
  threadTs: string
): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }
  try {
    const current = await getActiveStatusContext();
    if (current?.channelId === channelId && current?.threadTs === threadTs) {
      await client.del(ACTIVE_STATUS_KEY);
    }
  } catch {
    /* noop */
  }
}

export async function clearStream(threadId: string): Promise<void> {
  const client = getRedis();
  if (!client) {
    return;
  }

  try {
    await client.del(`${STREAM_PREFIX}${threadId}`);
  } catch (error) {
    logger.error("Failed to clear stream", { error: safeErrorMessage(error) });
  }
}

export async function getActiveStreams(): Promise<StreamEntry[]> {
  const client = getRedis();
  if (!client) {
    return [];
  }

  try {
    const keys = await scanKeys(client, `${STREAM_PREFIX}*`);
    if (keys.length === 0) {
      return [];
    }

    const values = await Promise.all(
      keys.map((key) => client.get<string>(key))
    );
    return values
      .filter((v): v is string => v !== null && v !== undefined)
      .map((v) => parseEntry<StreamEntry>(v));
  } catch (error) {
    logger.error("Failed to get active streams", {
      error: safeErrorMessage(error),
    });
    return [];
  }
}

export async function hasActionForThread(threadKey: string): Promise<boolean> {
  const client = getRedis();
  if (!client) {
    return false;
  }

  try {
    const actionId = await client.get<string>(
      `${THREAD_ACTION_PREFIX}${threadKey}`
    );
    return actionId !== null;
  } catch {
    return false;
  }
}

export async function getThreadKeyForAction(
  actionId: string
): Promise<string | null> {
  const client = getRedis();
  if (!client) {
    return null;
  }

  try {
    return await client.get<string>(`${ACTION_THREAD_PREFIX}${actionId}`);
  } catch (error) {
    logger.error("Failed to get thread key for action", {
      error: safeErrorMessage(error),
    });
    return null;
  }
}

export async function getStreamByThreadKey(
  threadKey: string
): Promise<StreamEntry | null> {
  const client = getRedis();
  if (!client) {
    return null;
  }

  try {
    const raw = await client.get<string>(`${STREAM_PREFIX}${threadKey}`);
    if (!raw) {
      return null;
    }
    return parseEntry<StreamEntry>(raw);
  } catch (error) {
    logger.error("Failed to get stream by thread key", {
      error: safeErrorMessage(error),
    });
    return null;
  }
}
