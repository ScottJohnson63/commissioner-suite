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
//   ordered newest-first. No auth required — only accessible to server admins
//   who know the URL (could be protected by middleware if needed).
//
// POST:
//   Body: { message, stack?, username?, url? }
//   `message` is required. All other fields are optional context.
//   Returns the new entry's `id` so the client can correlate the report.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

export async function GET(req: NextRequest): Promise<NextResponse> {
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      message?: string;
      stack?: string;
      username?: string;
      url?: string;
    };

    if (!body.message) {
      return err('message is required', 400);
    }

    const entry = await prisma.errorLog.create({
      data: {
        message: String(body.message),
        stack:   body.stack   ? String(body.stack)   : undefined,
        username: body.username ? String(body.username) : undefined,
        url:     body.url     ? String(body.url)     : undefined,
      },
    });

    return ok({ id: entry.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to write error log';
    return err(message);
  }
}
