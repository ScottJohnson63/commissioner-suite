// src/app/api/leagues/sync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchLeagueData } from '@/lib/sleeper/sync';
import { writeAuditLog } from '@/lib/audit';

export async function POST(
  req: NextRequest
): Promise<NextResponse> {

  const body = await req.json() as { leagueIds?: string[] };

  if (!Array.isArray(body.leagueIds) || body.leagueIds.length === 0) {
    return NextResponse.json({ error: 'leagueIds must be a non-empty array' }, { status: 400 });
  }

  const results: { leagueId: string; sleeperLeagueId: string; teamCount: number }[] = [];

  for (const leagueId of body.leagueIds) {
    try {
      const { leagueId: sleeperLeagueId, name, season, teams } = await fetchLeagueData(leagueId);

      const league = await prisma.league.upsert({
        where: { sleeperLeagueId },
        update: { name, season },
        create: { sleeperLeagueId, name, season, divisionCount: 2 },
      });

      await Promise.all(
        teams.map((t) =>
          prisma.team.upsert({
            where: { leagueId_sleeperRosterId: { leagueId: league.id, sleeperRosterId: t.id } },
            update: { name: t.name, divisionId: t.divisionId },
            create: {
              leagueId: league.id,
              sleeperRosterId: t.id,
              name: t.name,
              divisionId: t.divisionId,
            },
          }),
        ),
      );

      await writeAuditLog('SYNC', league.id, {
        sleeperLeagueId,
        name,
        season,
        teamCount: teams.length,
      });

      results.push({ leagueId: league.id, sleeperLeagueId, teamCount: teams.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Sync error for league ${leagueId}:`, err);
      return NextResponse.json(
        { error: `Failed on league ${leagueId}: ${message}`, results },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
