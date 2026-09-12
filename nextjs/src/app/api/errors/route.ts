// src/app/api/errors/route.ts
//
// GET  /api/errors?limit={n}   — fetches recent client-side error log entries.
// POST /api/errors              — writes a new error log entry from the browser.
//
// This endpoint acts as a lightweight client-side error reporter. The browser's
// global `error` / `unhandledrejection` handlers POST here so that runtime
// errors caught by the React error boundary or other global handlers are
// persisted in the DB for debugging without needing a third-party error service.
//
// GET:
//   Returns the most recent `limit` entries (capped at 500, default 100),
//   ordered newest-first. Commissioner only: the entries carry stack traces,
//   the URL the visitor was on, and their username, which makes this the most
//   sensitive read in the API. The header here used to claim the route was
//   "only accessible to server admins who know the URL" — nothing enforced
//   that, and the URL is in the page's own JavaScript bundle.
//
//   `/log`, the only page that reads this, shows nothing to anyone but the
//   `admin` account, so the route was narrowed to match the audience it
//   actually has — bearing in mind that admin and COMMISSIONER are separate
//   ideas in this app, and COMMISSIONER is the wider of the two.
//
// POST:
//   Body: { message, stack?, username?, url? }
//   `message` is required. All other fields are optional context.
//   Returns the new entry's `id` so the client can correlate the report.
//
//   Deliberately open to signed-out visitors — a crash on the public dashboard
//   is exactly the report worth having — so it is bounded instead of guarded:
//   ERROR_REPORT_LIMIT rows per IP per window, and every stored field truncated
//   to the lengths below. Both matter, since one request otherwise buys one
//   unbounded row.
//
// AUTH: GET  commissioner
// AUTH: POST public — the browser's global error handlers post from the login
//      page too, so a guard here would drop the reports that matter most

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';
import { requireCommissioner } from '@/lib/apiAuth';
import {
  checkErrorReportLimit, getClientIp, ERROR_REPORT_LIMIT,
} from '@/lib/rateLimit';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await requireCommissioner();
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const limitParam = searchParams.get('limit');
  const take = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

  try {
    const logs = await prisma.errorLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return ok(logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch error logs';
    return err(message);
  }
}

/**
 * Per-field caps on what is stored.
 *
 * A stack is the one field with a legitimate claim to length, so it gets the
 * room; the rest are short by nature and a long value means the caller is not
 * the error reporter. Over-long values are truncated rather than rejected —
 * the first lines of a stack are the useful ones, and a report that arrives
 * shortened beats one refused.
 */
const MAX_LENGTHS = { message: 2_000, stack: 8_000, username: 100, url: 500 } as const;

/**
 * Largest request body accepted, well above a truthful report of every field.
 *
 * Compared against `content-length` in bytes and against the decoded body in
 * characters. A character is never fewer than one byte, so the second check is
 * the looser of the two — it exists to catch a body that declared no length.
 */
const MAX_BODY_BYTES = 32 * 1024;

/**
 * Normalises one optional field: a non-empty string, truncated to `max`.
 *
 * Non-strings are dropped rather than coerced. The old handler ran every field
 * through `String()`, which turned an object into the useless `[object Object]`
 * and an array into its joined elements.
 */
function clamp(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { allowed, remaining, resetAt } = checkErrorReportLimit(getClientIp(req));
  const rateHeaders = {
    'X-RateLimit-Limit':     String(ERROR_REPORT_LIMIT),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset':     String(resetAt),
  };

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many error reports. Please wait before sending more.', resetAt },
      { status: 429, headers: rateHeaders },
    );
  }

  try {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return err('Error report is too large', 413);
    }

    // Read as text first so an oversized body that declared no length — or lied
    // about it — is turned away before it is parsed.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return err('Error report is too large', 413);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err('Request body must be valid JSON', 400);
    }

    // `JSON.parse` happily answers with null, a number or an array, and reading
    // a field off the first of those throws — which the catch below would then
    // report as a 500 for what is squarely the caller's mistake.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return err('Request body must be a JSON object', 400);
    }
    const body = parsed as { message?: unknown; stack?: unknown; username?: unknown; url?: unknown };

    const message = clamp(body.message, MAX_LENGTHS.message);
    if (!message) {
      return err('message is required', 400);
    }

    const entry = await prisma.errorLog.create({
      data: {
        message,
        stack:    clamp(body.stack,    MAX_LENGTHS.stack),
        username: clamp(body.username, MAX_LENGTHS.username),
        url:      clamp(body.url,      MAX_LENGTHS.url),
      },
    });

    return NextResponse.json({ id: entry.id }, { headers: rateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to write error log';
    return err(message);
  }
}
