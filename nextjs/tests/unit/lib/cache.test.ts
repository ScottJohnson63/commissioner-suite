// tests/unit/lib/cache.test.ts
//
// Tests for the in-process TTL cache in src/lib/cache.ts.
// Uses fake timers so we can advance time without real sleeps.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RouteCache } from '@/lib/cache';

describe('RouteCache', () => {
  // Start each test with a fresh cache instance so state does not leak between tests.
  let cache: RouteCache<string>;

  beforeEach(() => {
    cache = new RouteCache<string>();
    // Replace real timers with a Jest-controlled clock so Date.now() is deterministic.
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Always restore real timers to avoid affecting other test files.
    jest.useRealTimers();
  });

  // WHY: Ensures get() on an empty cache returns null rather than undefined or
  //      throwing, which would crash callers that rely on a null check.
  it('returns null for a key that was never set', () => {
    expect(cache.get('missing', 5000)).toBeNull();
  });

  // WHY: Core happy-path contract: set then get within TTL must return the stored value.
  it('returns stored data when retrieved within the TTL', () => {
    cache.set('key', 'hello');
    // Advance 1 second — well within a 5-second TTL.
    jest.advanceTimersByTime(1000);
    expect(cache.get('key', 5000)).toBe('hello');
  });

  // WHY: After the TTL elapses the entry is stale and should be treated as a miss.
  //      This is the primary correctness guarantee of the cache.
  it('returns null after the TTL has expired', () => {
    cache.set('key', 'hello');
    // Advance past the 5-second TTL.
    jest.advanceTimersByTime(6000);
    expect(cache.get('key', 5000)).toBeNull();
  });

  // WHY: Two independent keys must not clobber each other — basic isolation check.
  it('stores and retrieves two different keys independently', () => {
    cache.set('alpha', 'aaa');
    cache.set('beta', 'bbb');
    expect(cache.get('alpha', 5000)).toBe('aaa');
    expect(cache.get('beta', 5000)).toBe('bbb');
  });

  // WHY: clear() must evict the entry so subsequent gets return null, not the
  //      stale value. Critical for cache invalidation after a data update.
  it('returns null after the key is cleared', () => {
    cache.set('key', 'hello');
    cache.clear('key');
    expect(cache.get('key', 5000)).toBeNull();
  });

  // WHY: clear() on a missing key must be a no-op, not throw.
  it('does not throw when clearing a key that does not exist', () => {
    expect(() => cache.clear('nonexistent')).not.toThrow();
  });

  // WHY: set() overwrites the existing entry and resets its timestamp, so the
  //      TTL window starts fresh from the second set() call.
  it('resets the timestamp when the same key is set again', () => {
    cache.set('key', 'first');
    // Advance 4 seconds — still within original 5 s TTL.
    jest.advanceTimersByTime(4000);
    // Overwrite: new entry stamped at t=4s.
    cache.set('key', 'second');
    // Advance another 4 seconds (t=8s from start, but only 4s from overwrite).
    jest.advanceTimersByTime(4000);
    // Should still be valid because the overwrite reset the clock.
    expect(cache.get('key', 5000)).toBe('second');
  });

  // WHY: The generic type parameter must work with non-string value types.
  //      Catches a type-narrowing bug that could silently coerce objects.
  it('works with object values (generic type param)', () => {
    const objCache = new RouteCache<{ count: number }>();
    objCache.set('obj', { count: 42 });
    expect(objCache.get('obj', 5000)).toEqual({ count: 42 });
  });

  // WHY: Arrays are a common cached type (e.g. player lists). Verify the
  //      generic works correctly for array values too.
  it('works with array values', () => {
    const arrCache = new RouteCache<number[]>();
    arrCache.set('nums', [1, 2, 3]);
    expect(arrCache.get('nums', 5000)).toEqual([1, 2, 3]);
  });
});
