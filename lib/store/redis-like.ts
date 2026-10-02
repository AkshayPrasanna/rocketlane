/**
 * The handful of Redis commands the store needs. Production uses Upstash REST;
 * tests and local runs use `MemoryRedis`. Values are always plain strings.
 */
export interface RedisLike {
  del(...keys: string[]): Promise<void>;
  get(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  rpush(key: string, value: string): Promise<void>;
  /** Resolves true when the value was written, false when `nx` found an existing key. */
  set(
    key: string,
    value: string,
    options?: { ex?: number; nx?: boolean }
  ): Promise<boolean>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
}
