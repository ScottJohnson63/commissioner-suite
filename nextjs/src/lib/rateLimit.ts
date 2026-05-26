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
//     midnight. Used for observability (logged on each response) rather than
//     hard blocking, so commissioners can see total daily AI usage.
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
