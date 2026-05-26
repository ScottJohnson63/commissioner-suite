// src/app/api/assoc/divisions/route.ts
//
// POST /api/assoc/divisions
//
// Persists division assignments for all teams in a league. Called by the
// commissioner after dragging teams into division slots on the Divisions tab.
//
// Request body:
//   leagueId  — internal league ID
//   standings — array of StandingEntry (from /api/assoc/standings), each
//               carrying a `rosterId` and the target `division` number (1 | 2)
//
// Each roster is matched to its Team record by sleeperRosterId and its
// divisionId is updated to `division - 1` (converting from 1-indexed Sleeper
// division numbers to our 0-indexed internal format).
//
// The operation is audited under the GENERATE action type so it appears in the
// activity log alongside schedule generation and lottery events.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';
import type { StandingEntry } from '@/app/api/assoc/standings/route';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { leagueId?: string; standings?: StandingEntry[] };

  if (!body.leagueId || !Array.isArray(body.standings) || body.standings.length === 0) {
    return err('leagueId and standings are required', 400);
  }

  const { leagueId, standings } = body;

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return err('League not found', 404);

  await Promise.all(
    standings.map((s) =>
      prisma.team.updateMany({
        where: { leagueId, sleeperRosterId: String(s.rosterId) },
        data: { divisionId: s.division - 1 },
      }),
    ),
  );

  await writeAuditLog('GENERATE', leagueId, {
    type: 'divisions',
    teamCount: standings.length,
    divisions: standings.map((s) => ({ rosterId: s.rosterId, name: s.name, division: s.division })),
  });

  return ok({ updated: standings.length });
}
