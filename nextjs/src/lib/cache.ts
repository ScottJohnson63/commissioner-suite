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
}
