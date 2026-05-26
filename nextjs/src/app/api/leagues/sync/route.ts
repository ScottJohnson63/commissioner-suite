// src/app/api/leagues/sync/route.ts
//
// POST /api/leagues/sync
//
// Syncs one or more Sleeper leagues into the local database. Called from the
// Commissioner dashboard's "Sync League" button.
//
// Request body:
//   leagueIds — array of Sleeper league IDs to sync (at least one required)
//
// For each league ID, the handler:
//   1. Fetches league metadata, rosters, and users from the Sleeper API.
//   2. Validates that the league has exactly 2 divisions.
//   3. Upserts the League record (creates or updates name/season).
//   4. Upserts each Team record (creates or updates name/divisionId).
//   5. Writes a SYNC audit log entry.
//
// If any league fails, the handler returns a 500 with partial results and the
// error message. The caller can retry the failed league independently.
//
// Note: upserts are keyed on `sleeperLeagueId` (League) and on the
// `leagueId_sleeperRosterId` composite (Team), so repeated syncs are idempotent.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchLeagueData } from '@/lib/sleeper/sync';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';

export async function POST(
  req: NextRequest
): Promise<NextResponse> {

  const body = await req.json() as { leagueIds?: string[] };

  if (!Array.isArray(body.leagueIds) || body.leagueIds.length === 0) {
    return err('leagueIds must be a non-empty array', 400);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Sync error for league ${leagueId}:`, error);
      // Include partial results in the error body — can't use err() here.
      return NextResponse.json(
        { error: `Failed on league ${leagueId}: ${message}`, results },
        { status: 500 },
      );
    }
  }

  return ok({ synced: results.length, results });
}
