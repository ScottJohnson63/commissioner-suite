// src/app/api/leagues/[id]/route.ts
//
// DELETE /api/leagues/[id]   — unregister a league (commissioner only).
//
// Removing a league takes it out of every selector and stops the scheduled
// Sleeper jobs from touching it, so this is the counterpart to POST /api/leagues
// and the escape hatch for a mistyped league ID.
//
// This deletes the league's data, not just the row. Order matters, and the
// libsql adapter has no interactive transactions, so the deletes run
// newest-dependency-first and are individually idempotent. A partial failure
// leaves orphaned children rather than a dangling parent, which is the safer
// half to be left holding.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';
import { requireCommissioner } from '@/lib/apiAuth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await requireCommissioner();
  if (denied) return denied;

  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    select: { id: true, name: true, sleeperLeagueId: true },
  });
  if (!league) return err('League not found', 404);

  try {
    // Matchups reference Schedule and Team, so they go before both.
    const schedules = await prisma.schedule.findMany({
      where: { leagueId: id },
      select: { id: true },
    });
    if (schedules.length > 0) {
      await prisma.matchup.deleteMany({
        where: { scheduleId: { in: schedules.map((s) => s.id) } },
      });
    }

    await prisma.schedule.deleteMany({ where: { leagueId: id } });
    await prisma.sleeperRanking.deleteMany({ where: { leagueId: id } });
    await prisma.team.deleteMany({ where: { leagueId: id } });

    // AuditLog.leagueId is onDelete: SetNull, so the history survives the
    // league it describes — deliberately not deleted here.
    await prisma.league.delete({ where: { id } });

    return ok({ removed: league.sleeperLeagueId, name: league.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('League delete failed:', error);
    return err(`Could not remove that league: ${message}`);
  }
}
