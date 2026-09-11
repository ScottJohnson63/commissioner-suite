// src/lib/rateLimit.ts
//
// In-process rate-limiting.
//
// The building block is a fixed-window bucket map (`createFixedWindowLimiter`):
// N requests per client per rolling window, counted in memory. Two features use
// it, and each owns its own limiter so their counts never share a bucket:
//
//   AI agent, per client — keyed by IP (or x-client-id header).
//     Each client is allowed HOURLY_LIMIT prompts per rolling 60-minute window.
//     The window resets automatically after one hour of inactivity.
//
//   AI agent, global daily counter — a single process-wide counter that resets
//     at UTC midnight, capped at DAILY_LIMIT. It is the app's copy of the
//     answering provider's daily quota: reaching ours first means the reader
//     gets our message instead of a raw provider 429 from inside a streaming
//     answer. Not a fixed-window bucket — it is one counter for everyone.
//
//   Client error reports — keyed by IP alone, because POST /api/errors is open
//     to signed-out visitors and writes a database row per call.
//     See ERROR_REPORT_LIMIT.
//
// Caveats:
//   • State is in-process only — a cold start or deployment resets all counters.
//   • Multi-instance deployments (e.g. multiple Vercel workers) each maintain
//     their own independent state, so the effective limit per client scales with
//     the number of active instances. This is acceptable for the current load.

import type { NextRequest } from 'next/server';

// ── Fixed-window limiter ──────────────────────────────────────────────────────

/** Rolling count + window-start timestamp for a single client. */
interface Bucket { count: number; windowStart: number; }

/** The answer to "may this request proceed?", with the state behind it. */
export interface LimitVerdict { allowed: boolean; remaining: number; resetAt: number; }

/** The same state, read without spending from it. */
export interface LimitUsage { used: number; remaining: number; resetAt: number; }

/** A bucket map: `limit` requests per client per `windowMs`. */
export interface FixedWindowLimiter {
  readonly limit: number;
  readonly windowMs: number;
  /** Consumes one token when the client is under the limit. */
  check(clientId: string): LimitVerdict;
  /** Reads a client's current usage without consuming a token. */
  peek(clientId: string): LimitUsage;
  /** How many buckets are currently held — what the sweep below keeps bounded. */
  size(): number;
}

/**
 * Builds an independent in-memory limiter.
 *
 * Each call owns its own bucket map, so two features sharing this module cannot
 * spend from each other's allowance.
 *
 * Expired buckets are swept once per window rather than left to accumulate: the
 * error reporter is keyed by an IP header that an abusive caller can vary at
 * will, and without the sweep every distinct value would hold a bucket for the
 * life of the process.
 */
export function createFixedWindowLimiter(limit: number, windowMs: number): FixedWindowLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  const isExpired = (bucket: Bucket, now: number): boolean =>
    now - bucket.windowStart >= windowMs;

  function sweep(now: number): void {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (isExpired(bucket, now)) buckets.delete(key);
    }
  }

  return {
    limit,
    windowMs,

    check(clientId: string): LimitVerdict {
      const now = Date.now();
      sweep(now);
      let bucket = buckets.get(clientId);
      if (!bucket || isExpired(bucket, now)) {
        bucket = { count: 0, windowStart: now };
        buckets.set(clientId, bucket);
      }
      const resetAt = bucket.windowStart + windowMs;
      if (bucket.count >= limit) return { allowed: false, remaining: 0, resetAt };
      bucket.count += 1;
      return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt };
    },

    peek(clientId: string): LimitUsage {
      const now = Date.now();
      const bucket = buckets.get(clientId);
      if (!bucket || isExpired(bucket, now)) {
        return { used: 0, remaining: limit, resetAt: now + windowMs };
      }
      return {
        used:      Math.min(limit, bucket.count),
        remaining: Math.max(0, limit - bucket.count),
        resetAt:   bucket.windowStart + windowMs,
      };
    },

    size(): number {
      return buckets.size;
    },
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;

// ── AI agent ──────────────────────────────────────────────────────────────────

/** Maximum AI prompts allowed per client per 60-minute rolling window. */
export const HOURLY_LIMIT = 15;

/**
 * Maximum AI prompts the whole app will dispatch in one UTC day.
 *
 * This is the app's copy of the answering provider's requests-per-day quota,
 * and it exists so the reader meets our message rather than the provider's.
 * Without it the daily counter was observability only: the first request past
 * the provider's quota came back as a raw 429 from inside a streaming answer,
 * which the browser could only report as "the assistant is unavailable".
 *
 * The default is deliberately below the figure Google publishes for the Gemini
 * free tier, because that figure is assigned per project and is not the same
 * for everyone. Read your own in AI Studio and set AGENT_DAILY_LIMIT to it —
 * too low wastes quota, too high puts the provider's error in front of a user.
 */
export const DAILY_LIMIT = (() => {
  const configured = Number(process.env.AGENT_DAILY_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 250;
})();

/** The agent's per-client hourly allowance. */
const agentHourly = createFixedWindowLimiter(HOURLY_LIMIT, ONE_HOUR_MS);

/** Global daily prompt counter — resets at UTC midnight. */
interface DayBucket  { count: number; dayKey: string; }

let dailyBucket: DayBucket = { count: 0, dayKey: '' };

/** Returns today's date in YYYY-MM-DD format (UTC), used as the daily reset key. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the number of AI prompts issued today (process-wide, UTC day).
 * Resets automatically at UTC midnight.
 */
export function getDailyCount(): number {
  const key = todayKey();
  if (dailyBucket.dayKey !== key) dailyBucket = { count: 0, dayKey: key };
  return dailyBucket.count;
}

/** Unix ms of the next UTC midnight — when the daily counter rolls over. */
export function dailyResetAt(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/**
 * Whether the app has any of today's provider budget left.
 *
 * Peeks rather than spends: `incrementDaily()` is called once the request is
 * actually being dispatched, so a request refused for some other reason does
 * not eat a slot.
 */
export function checkDailyLimit(): { allowed: boolean; used: number; remaining: number; resetAt: number } {
  const used = getDailyCount();
  return {
    allowed:   used < DAILY_LIMIT,
    used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    resetAt:   dailyResetAt(),
  };
}

/**
 * Increments the global daily prompt counter.
 * Should be called once per successfully dispatched AI request.
 */
export function incrementDaily(): void {
  const key = todayKey();
  if (dailyBucket.dayKey !== key) dailyBucket = { count: 0, dayKey: key };
  dailyBucket.count += 1;
}

/**
 * Checks whether `clientId` is within their hourly limit, and if so,
 * consumes one token from their bucket.
 *
 * @param clientId  Stable identifier for the caller (IP address or custom header).
 * @returns  `allowed` — false if the limit was already reached (token not consumed).
 *           `remaining` — tokens left in the current window after this call.
 *           `resetAt` — Unix-ms timestamp when the window expires.
 */
export function checkHourlyLimit(clientId: string): LimitVerdict {
  return agentHourly.check(clientId);
}

/**
 * Reads a client's current hourly usage WITHOUT consuming a token.
 *
 * The page needs this on load. The usage meter used to start every page at
 * 0/15 because the browser had no memory of the window and no way to ask: the
 * only call that knew the count was the one that spent from it, so a refresh
 * showed a full allowance the server was not going to honour. This is the same
 * bucket read rather than debited.
 *
 * A client with no bucket yet is reported as a fresh window starting now — the
 * window does not exist until the first prompt, and `resetAt` an hour out is
 * the truthful answer to "when does this reset" for someone who has spent
 * nothing.
 */
export function peekHourlyLimit(clientId: string): LimitUsage {
  return agentHourly.peek(clientId);
}

// ── Client error reports ──────────────────────────────────────────────────────

/**
 * Error reports accepted from one IP per ERROR_REPORT_WINDOW_MS.
 *
 * POST /api/errors cannot require a session — the whole point is to catch the
 * crash that a signed-out visitor hit on the public dashboard — and it writes a
 * database row per call, so the limit is the only thing standing between that
 * endpoint and an unbounded flood of rows.
 *
 * The number is set for the worst honest case rather than the typical one: a
 * page whose render loop throws can fire a handful of reports a second for a
 * few seconds before the visitor gives up and closes the tab. Twenty per ten
 * minutes covers that and still leaves a determined single IP writing orders of
 * magnitude fewer rows than it could before.
 */
export const ERROR_REPORT_LIMIT = 20;

/** The window ERROR_REPORT_LIMIT is counted over. */
export const ERROR_REPORT_WINDOW_MS = 10 * 60 * 1000;

const errorReports = createFixedWindowLimiter(ERROR_REPORT_LIMIT, ERROR_REPORT_WINDOW_MS);

/**
 * Checks whether `clientIp` may file another error report, consuming one slot
 * when it may.
 *
 * Key this with `getClientIp()`, not `getClientId()`: the latter honours a
 * request header the caller sets, which on an open endpoint is a bypass rather
 * than an identity.
 */
export function checkErrorReportLimit(clientIp: string): LimitVerdict {
  return errorReports.check(clientIp);
}

// ── Identifying the caller ────────────────────────────────────────────────────

/**
 * Extracts a stable client identifier from the incoming request.
 *
 * Resolution order:
 *   1. `x-client-id` header  — set by the browser client for persistent identity.
 *   2. `x-forwarded-for`     — first IP in the proxy chain (set by Vercel/CDN).
 *   3. `'unknown'`           — fallback when neither header is present.
 *
 * The `x-client-id` preference is what the agent's usage meter is keyed on, and
 * it means a caller can choose their own bucket. That is a fair trade where the
 * route is already behind a session; on an unauthenticated route, prefer
 * `getClientIp()`.
 *
 * @param req  The incoming Next.js request.
 * @returns    A trimmed string identifying the client.
 */
export function getClientId(req: NextRequest): string {
  return (
    req.headers.get('x-client-id')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * The caller's IP as the edge saw it, for limits that must not be self-assigned.
 *
 * `NextRequest.ip` was removed in Next 15, so the proxy's own headers are the
 * only source: `x-forwarded-for`'s first hop, then `x-real-ip`. Both are
 * spoofable by anything talking to the origin directly, but on Vercel the CDN
 * rewrites them, and unlike `x-client-id` they are not a documented knob the
 * browser is expected to set.
 *
 * Callers with neither header share the `'unknown'` bucket. That is deliberate:
 * an unidentifiable flood is rate-limited as one caller rather than waved
 * through as many.
 */
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
