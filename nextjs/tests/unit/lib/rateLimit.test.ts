// tests/unit/lib/rateLimit.test.ts
//
// Tests for the in-process rate-limiter in src/lib/rateLimit.ts.
//
// IMPORTANT: The module uses module-level global state (hourlyBuckets and
// dailyBucket). We reset that state by calling jest.resetModules() and
// re-requiring the module before each test so previous test runs don't bleed
// through. Fake timers control Date.now() so we don't need real delays.

import {
  describe, it, expect, beforeEach, afterEach, jest,
} from '@jest/globals';

// Import types only so TypeScript stays happy after the resetModules dance.
import type { NextRequest } from 'next/server';

describe('rateLimit module', () => {
  // We import the module fresh inside each test to avoid shared state leaking.
  // These variables are reassigned inside beforeEach.
  let getDailyCount:   () => number;
  let incrementDaily:  () => void;
  let checkHourlyLimit: (id: string) => { allowed: boolean; remaining: number; resetAt: number };
  let getClientId:     (req: NextRequest) => string;
  let HOURLY_LIMIT:    number;

  beforeEach(async () => {
    // Replace real time with a fixed clock starting at a known UTC timestamp
    // (2025-01-01 00:00:00 UTC). This makes todayKey() deterministic.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    // Destroy and re-require the module so the module-level globals are reset.
    jest.resetModules();
    const mod = await import('@/lib/rateLimit');
    getDailyCount     = mod.getDailyCount;
    incrementDaily    = mod.incrementDaily;
    checkHourlyLimit  = mod.checkHourlyLimit;
    getClientId       = mod.getClientId;
    HOURLY_LIMIT      = mod.HOURLY_LIMIT;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  // ── Daily counter ────────────────────────────────────────────────────────────

  // WHY: getDailyCount on a new day key should initialise to 0 rather than
  //      returning undefined or retaining a stale value from a previous day.
  it('getDailyCount returns 0 at the start of a new day', () => {
    expect(getDailyCount()).toBe(0);
  });

  // WHY: incrementDaily should bump the counter by exactly 1 each call.
  //      verifies the counter is not being reset or skipped.
  it('incrementDaily increments the daily count by 1', () => {
    incrementDaily();
    expect(getDailyCount()).toBe(1);
    incrementDaily();
    expect(getDailyCount()).toBe(2);
  });

  // WHY: The daily counter must reset at midnight UTC, not carry over from the
  //      previous day. This prevents the display count from growing forever.
  it('getDailyCount resets to 0 when the calendar day changes', () => {
    // Increment on day 1
    incrementDaily();
    expect(getDailyCount()).toBe(1);

    // Advance clock past midnight to the next UTC day
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    // Counter should reset because todayKey() now returns a different date
    expect(getDailyCount()).toBe(0);
  });

  // ── Hourly bucket ────────────────────────────────────────────────────────────

  // WHY: The first call for a new client must be allowed and return
  //      HOURLY_LIMIT - 1 as the remaining count.
  it('checkHourlyLimit allows the first call and returns HOURLY_LIMIT - 1 remaining', () => {
    const result = checkHourlyLimit('client-A');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(HOURLY_LIMIT - 1);
  });

  // WHY: After HOURLY_LIMIT calls the next request must be rejected. This is
  //      the core rate-limiting invariant.
  it('checkHourlyLimit blocks requests after HOURLY_LIMIT is reached', () => {
    for (let i = 0; i < HOURLY_LIMIT; i++) {
      checkHourlyLimit('client-B');
    }
    const result = checkHourlyLimit('client-B');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  // WHY: The hourly window is rolling — after 1 hour the bucket resets and
  //      the client can make HOURLY_LIMIT requests again.
  it('checkHourlyLimit allows requests again after the 1-hour window resets', () => {
    // Exhaust the limit
    for (let i = 0; i < HOURLY_LIMIT; i++) {
      checkHourlyLimit('client-C');
    }
    expect(checkHourlyLimit('client-C').allowed).toBe(false);

    // Advance past the 1-hour rolling window
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    // Should be allowed again with a fresh bucket
    const result = checkHourlyLimit('client-C');
    expect(result.allowed).toBe(true);
  });

  // WHY: Rate limits must be per-client — exhausting client A's bucket must
  //      not affect client B's remaining tokens.
  it('rate limits for different clients are independent', () => {
    // Exhaust client A
    for (let i = 0; i < HOURLY_LIMIT; i++) {
      checkHourlyLimit('client-A');
    }
    expect(checkHourlyLimit('client-A').allowed).toBe(false);

    // Client B is unaffected
    expect(checkHourlyLimit('client-B').allowed).toBe(true);
  });

  // WHY: resetAt must be the window-start + 1 hour so clients can display a
  //      countdown to when they can retry.
  it('resetAt is approximately 1 hour from when the window opened', () => {
    const now = Date.now();
    const { resetAt } = checkHourlyLimit('client-D');
    const oneHourMs = 60 * 60 * 1000;
    // resetAt should be very close to now + 1 hour (within 100 ms of fake time)
    expect(resetAt).toBeGreaterThanOrEqual(now + oneHourMs - 100);
    expect(resetAt).toBeLessThanOrEqual(now + oneHourMs + 100);
  });

  // ── getClientId ──────────────────────────────────────────────────────────────

  // Helper that builds a minimal NextRequest-shaped stub with specific headers.
  function makeReq(headers: Record<string, string>): NextRequest {
    return {
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
    } as unknown as NextRequest;
  }

  // WHY: The x-client-id header is set by the browser for persistent identity
  //      across sessions. It must take priority over the IP-based fallback.
  it('getClientId returns the x-client-id header value when present', () => {
    const req = makeReq({ 'x-client-id': '  browser-uuid-123  ' });
    expect(getClientId(req)).toBe('browser-uuid-123');
  });

  // WHY: x-forwarded-for can contain a comma-separated chain of IPs (proxies
  //      prepend their address). Only the first IP (the real client) should be used.
  it('getClientId returns the first IP from x-forwarded-for', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.1' });
    expect(getClientId(req)).toBe('1.2.3.4');
  });

  // WHY: When neither header is present (e.g. direct local connections) the
  //      function must return the sentinel string 'unknown' so rate-limit buckets
  //      still work — they just bucket everyone without a header together.
  it("getClientId returns 'unknown' when no identifying header is present", () => {
    const req = makeReq({});
    expect(getClientId(req)).toBe('unknown');
  });

  // WHY: x-client-id takes priority over x-forwarded-for when both are present,
  //      so an identified browser client is not accidentally rate-limited by IP.
  it('getClientId prefers x-client-id over x-forwarded-for', () => {
    const req = makeReq({
      'x-client-id': 'my-uuid',
      'x-forwarded-for': '9.9.9.9',
    });
    expect(getClientId(req)).toBe('my-uuid');
  });
});
