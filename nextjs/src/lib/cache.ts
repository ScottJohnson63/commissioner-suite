// src/lib/cache.ts
//
// Generic in-process TTL cache for API route handlers.
//
// Each API route instantiates one RouteCache<T> at module scope so the cache
// survives across requests within a single server process. Entries older than
// the caller-supplied TTL are treated as misses and evicted lazily on next get.
//
// This is intentionally simple: no background eviction, no max-size, no
// persistence. It is scoped to a single server process — a cold start or a
// deployment reset produces an empty cache and warms up on the next request.

/**
 * How long an assembled route response may be reused, in milliseconds.
 *
 * This is the outermost of the app's caching layers, and the one that actually
 * decides what a user sees: a RouteCache hit returns without touching the
 * Sleeper fetch cache underneath it, so a long value here overrides every
 * SLEEPER_TTL below it. A 15-minute response cache in front of a 30-second
 * fetch TTL is a 15-minute page.
 *
 * These were four separate per-route constants (5, 10, 10 and 15 minutes) with
 * no shared rationale. They are one decision, so they live in one place.
 */
export const ROUTE_CACHE_TTL = {
  /**
   * Responses built from live league state — matchups, reports, suggestions.
   *
   * Short enough that a score or a roster move shows up on the next click, long
   * enough that re-renders and multiple panels on one page share a single build.
   */
  LIVE: 60_000,
} as const;

/**
 * Lightweight in-process key→value cache with per-lookup TTL enforcement.
 *
 * @template T  Type of the cached values.
 */
export class RouteCache<T> {
  private store = new Map<string, { data: T; ts: number }>();

  /**
   * Returns the cached value for `key` if it was stored within the last
   * `ttlMs` milliseconds, otherwise returns null.
   *
   * @param key    Cache key.
   * @param ttlMs  Maximum age of a valid entry, in milliseconds.
   */
  get(key: string, ttlMs: number): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttlMs) return null;
    return entry.data;
  }

  /**
   * Stores `data` under `key`, timestamping it at the current time.
   * Overwrites any existing entry for the same key.
   *
   * @param key   Cache key.
   * @param data  Value to store.
   */
  set(key: string, data: T): void {
    this.store.set(key, { data, ts: Date.now() });
  }

  /**
   * Removes the entry for `key` from the cache.
   * No-op if the key does not exist.
   *
   * @param key  Cache key to evict.
   */
  clear(key: string): void {
    this.store.delete(key);
  }

  /**
   * Drops every entry.
   *
   * Exists for tests: a module-scope cache outlives an individual test, so one
   * that memoises per league or per season leaks its first answer into the rest
   * of the file unless it can be emptied between cases.
   */
  clearAll(): void {
    this.store.clear();
  }
}
