import { getEnv } from "@/lib/env";
import { MemoryRedis } from "./memory-redis";
import { createRedisStore } from "./redis-store";
import type { Store } from "./types";
import { createUpstashRedis } from "./upstash-redis";

let cached: Store | null = null;

/** A fresh in-process store, optionally with a fixed clock. Used by tests. */
export function createMemoryStore(clock?: () => Date): Store {
  return createRedisStore(new MemoryRedis(), clock);
}

/**
 * Upstash when credentials exist; otherwise an in-process store for local development.
 * Serverless invocations don't share memory, so production without Redis would silently
 * lose state. We refuse to start in that case.
 */
export function getStore(): Store {
  if (cached) {
    return cached;
  }
  const { redis } = getEnv();
  if (redis) {
    cached = createRedisStore(createUpstashRedis(redis));
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Redis is required in production: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)."
    );
  } else {
    cached = createMemoryStore();
  }
  return cached;
}
