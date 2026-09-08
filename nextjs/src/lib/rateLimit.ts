// src/lib/rateLimit.ts
//
// In-process rate-limiting for the AI agent route.
//
// Two independent, in-memory buckets guard against runaway LLM costs:
//
//   Per-client hourly bucket — keyed by IP (or x-client-id header).
//     Each client is allowed HOURLY_LIMIT prompts per rolling 60-minute window.
//     The window resets automatically after one hour of inactivity.
//
//   Global daily counter — a single process-wide counter that resets at UTC
//     midnight, capped at DAILY_LIMIT. It is the app's copy of the answering
//     provider's daily quota: reaching ours first means the reader gets our
//     message instead of a raw provider 429 from inside a streaming answer.
//
// Caveats:
//   • State is in-process only — a cold start or deployment resets all counters.
//   • Multi-instance deployments (e.g. multiple Vercel workers) each maintain
//     their own independent state, so the effective limit per client scales with
//     the number of active instances. This is acceptable for the current load.

import type { NextRequest } from 'next/server';

/** Rolling count + window-start timestamp for a single client. */
interface HourBucket { count: number; windowStart: number; }

/** Global daily prompt counter — resets at UTC midnight. */
interface DayBucket  { count: number; dayKey: string; }

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

const hourlyBuckets = new Map<string, HourBucket>();
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
export function checkHourlyLimit(
  clientId: string,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  let bucket = hourlyBuckets.get(clientId);
  if (!bucket || now - bucket.windowStart >= ONE_HOUR_MS) {
    bucket = { count: 0, windowStart: now };
    hourlyBuckets.set(clientId, bucket);
  }
  const remaining = Math.max(0, HOURLY_LIMIT - bucket.count);
  const resetAt = bucket.windowStart + ONE_HOUR_MS;
  if (bucket.count >= HOURLY_LIMIT) return { allowed: false, remaining: 0, resetAt };
  bucket.count += 1;
  hourlyBuckets.set(clientId, bucket);
  return { allowed: true, remaining: remaining - 1, resetAt };
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
export function peekHourlyLimit(
  clientId: string,
): { used: number; remaining: number; resetAt: number } {
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const bucket = hourlyBuckets.get(clientId);
  if (!bucket || now - bucket.windowStart >= ONE_HOUR_MS) {
    return { used: 0, remaining: HOURLY_LIMIT, resetAt: now + ONE_HOUR_MS };
  }
  return {
    used:      Math.min(HOURLY_LIMIT, bucket.count),
    remaining: Math.max(0, HOURLY_LIMIT - bucket.count),
    resetAt:   bucket.windowStart + ONE_HOUR_MS,
  };
}

/**
 * Extracts a stable client identifier from the incoming request.
 *
 * Resolution order:
 *   1. `x-client-id` header  — set by the browser client for persistent identity.
 *   2. `x-forwarded-for`     — first IP in the proxy chain (set by Vercel/CDN).
 *   3. `'unknown'`           — fallback when neither header is present.
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
