import { Redis } from "@upstash/redis";
import type { RedisLike } from "./redis-like";

/**
 * Wraps Upstash REST. Automatic deserialization is off so that values round-trip as the
 * exact strings we wrote (otherwise numeric-looking IDs would be parsed into numbers).
 */
export function createUpstashRedis(credentials: {
  token: string;
  url: string;
}): RedisLike {
  const redis = new Redis({ ...credentials, automaticDeserialization: false });

  return {
    async del(...keys) {
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    },
    get: (key) => redis.get<string>(key),
    async lrange(key, start, stop) {
      return await redis.lrange<string>(key, start, stop);
    },
    async ltrim(key, start, stop) {
      await redis.ltrim(key, start, stop);
    },
    async mget(keys) {
      if (keys.length === 0) {
        return [];
      }
      return await redis.mget<(string | null)[]>(...keys);
    },
    async rpush(key, value) {
      await redis.rpush(key, value);
    },
    async set(key, value, options) {
      const ex = options?.ex;
      const result = options?.nx
        ? await redis.set(key, value, ex ? { ex, nx: true } : { nx: true })
        : await redis.set(key, value, ex ? { ex } : undefined);
      return result === "OK";
    },
    async zadd(key, score, member) {
      await redis.zadd(key, { member, score });
    },
    async zrem(key, member) {
      await redis.zrem(key, member);
    },
    async zrange(key, start, stop, options) {
      return await redis.zrange<string[]>(key, start, stop, {
        rev: options?.rev,
      });
    },
  };
}
