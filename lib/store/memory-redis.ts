import type { RedisLike } from "./redis-like";

interface SortedEntry {
  member: string;
  score: number;
}

/** Resolves Redis-style inclusive ranges, where negative indexes count from the end. */
function resolveRange(
  length: number,
  start: number,
  stop: number
): [number, number] {
  const from = start < 0 ? Math.max(length + start, 0) : start;
  const to = stop < 0 ? length + stop : Math.min(stop, length - 1);
  return [from, to];
}

/**
 * In-process stand-in for Redis. Expiry (`ex`) is accepted and ignored. It is only shared
 * within a single process, so use Upstash for anything spanning serverless invocations.
 */
export class MemoryRedis implements RedisLike {
  private readonly strings = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();
  private readonly sorted = new Map<string, SortedEntry[]>();

  del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.strings.delete(key);
      this.lists.delete(key);
      this.sorted.delete(key);
    }
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((key) => this.strings.get(key) ?? null));
  }

  set(
    key: string,
    value: string,
    options?: { ex?: number; nx?: boolean }
  ): Promise<boolean> {
    if (options?.nx && this.strings.has(key)) {
      return Promise.resolve(false);
    }
    this.strings.set(key, value);
    return Promise.resolve(true);
  }

  rpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return Promise.resolve();
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const [from, to] = resolveRange(list.length, start, stop);
    return Promise.resolve(list.slice(from, to + 1));
  }

  ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.lists.get(key);
    if (list) {
      const [from, to] = resolveRange(list.length, start, stop);
      this.lists.set(key, list.slice(from, to + 1));
    }
    return Promise.resolve();
  }

  zadd(key: string, score: number, member: string): Promise<void> {
    const entries = (this.sorted.get(key) ?? []).filter(
      (entry) => entry.member !== member
    );
    entries.push({ member, score });
    entries.sort((a, b) => a.score - b.score);
    this.sorted.set(key, entries);
    return Promise.resolve();
  }

  zrange(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<string[]> {
    const ordered = (this.sorted.get(key) ?? []).map((entry) => entry.member);
    if (options?.rev) {
      ordered.reverse();
    }
    const [from, to] = resolveRange(ordered.length, start, stop);
    return Promise.resolve(ordered.slice(from, to + 1));
  }
}
