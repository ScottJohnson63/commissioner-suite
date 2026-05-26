// src/app/api/audit/route.ts
//
// GET /api/audit?leagueId={id}&limit={n}
//
// Returns recent audit log entries for the Activity Log page.
//
// Query parameters:
//   leagueId — (optional) filter to entries for a specific league.
//              Omit to fetch entries across all leagues.
//   limit    — maximum number of entries to return (capped at 500, default 100).
//
// Entries are ordered newest-first and include the associated league record
// (id, name, season, sleeperLeagueId) so the Activity Log can display context
// without a second request.
//
// The `detail` column is stored as a JSON string; this handler parses it back
// to an object before returning so clients receive structured data.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId') ?? undefined;
  const limitParam = searchParams.get('limit');
  const take = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

  try {
    const raw = await prisma.auditLog.findMany({
      where: leagueId ? { leagueId } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        league: {
          select: { id: true, name: true, season: true, sleeperLeagueId: true },
        },
      },
    });
    const logs = raw.map((l) => ({
      ...l,
      detail: (() => { try { return JSON.parse(l.detail) as Record<string, unknown>; } catch { return {}; } })(),
    }));
    return ok(logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch audit logs';
    return err(message);
  }
}
