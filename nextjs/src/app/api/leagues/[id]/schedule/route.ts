// src/app/api/leagues/[id]/schedule/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/scheduler/engine';
import { Team } from '@/lib/scheduler/types';
import { fetchLeagueData } from '@/lib/sleeper/sync';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';

type LeagueWithTeams = NonNullable<Awaited<ReturnType<typeof findLeague>>>;

/** Find a league by internal DB id OR Sleeper league id — whichever the caller provides. */
async function findLeague(id: string) {
  return prisma.league.findFirst({
    where: { OR: [{ id }, { sleeperLeagueId: id }] },
    include: { teams: true },
  });
}

/**
 * Syncs a league (and its teams) from Sleeper, treating `sleeperLeagueId` as the
 * source of truth. Used when Generate Schedule is clicked before any prior sync.
 */
async function syncLeagueFromSleeper(sleeperLeagueId: string): Promise<LeagueWithTeams> {
  const { leagueId, name, season, teams: sleeperTeams } = await fetchLeagueData(sleeperLeagueId);

  const league = await prisma.league.upsert({
    where: { sleeperLeagueId: leagueId },
    update: { name, season },
    create: { sleeperLeagueId: leagueId, name, season, divisionCount: 2 },
  });

  await Promise.all(
    sleeperTeams.map((t) =>
      prisma.team.upsert({
        where: { leagueId_sleeperRosterId: { leagueId: league.id, sleeperRosterId: t.id } },
        update: { name: t.name, divisionId: t.divisionId },
        create: { leagueId: league.id, sleeperRosterId: t.id, name: t.name, divisionId: t.divisionId },
      }),
    ),
  );

  const refreshed = await findLeague(league.id);
  if (!refreshed) throw new Error('League not found after sync');
  return refreshed;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let league = await findLeague(id);

  // League not in DB yet — treat `id` as Sleeper league ID and perform a full sync.
  if (!league) {
    try {
      league = await syncLeagueFromSleeper(id);
    } catch (syncErr) {
      const msg = syncErr instanceof Error ? syncErr.message : 'Unknown error';
      return err(`Failed to sync league from Sleeper: ${msg}`);
    }
  }

  // Teams missing (league record exists but was never populated) — sync teams only.
  if (league.teams.length === 0) {
    try {
      const { teams: sleeperTeams } = await fetchLeagueData(league.sleeperLeagueId);
      await Promise.all(
        sleeperTeams.map((t) =>
          prisma.team.upsert({
            where: { leagueId_sleeperRosterId: { leagueId: league!.id, sleeperRosterId: t.id } },
            update: { name: t.name, divisionId: t.divisionId },
            create: { leagueId: league!.id, sleeperRosterId: t.id, name: t.name, divisionId: t.divisionId },
          }),
        ),
      );
      const refreshed = await findLeague(league.id);
      if (!refreshed) return err('League not found after team sync', 500);
      league = refreshed;
    } catch (syncErr) {
      const msg = syncErr instanceof Error ? syncErr.message : 'Unknown error';
      return err(`Failed to load teams from Sleeper: ${msg}`);
    }
  }

  const teams: Team[] = league.teams.map((t) => ({
    id: t.id,
    name: t.name,
    divisionId: t.divisionId as 0 | 1,
  }));

  const seed = Math.floor(Math.random() * 1_000_000);

  try {
    const schedule = generateSchedule(league.id, league.season, teams);

    const saved = await prisma.schedule.create({
      data: {
        leagueId: league.id,
        season: league.season,
        seed,
        matchups: {
          create: schedule.weeks.flatMap((week) =>
            week.matchups.map((m) => ({
              week: week.week,
              homeTeamId: m.home,
              awayTeamId: m.away,
              type: m.type,
            })),
          ),
        },
      },
      include: { matchups: true },
    });

    await writeAuditLog('GENERATE', league.id, {
      type: 'schedule',
      scheduleId: saved.id,
      season: league.season,
      matchupCount: saved.matchups.length,
      seed,
    });

    return ok({ scheduleId: saved.id, matchupCount: saved.matchups.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    return err(message);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const league = await findLeague(id);
  if (!league) return err('No schedule found', 404);

  const schedule = await prisma.schedule.findFirst({
    where: { leagueId: league.id },
    orderBy: { generatedAt: 'desc' },
    include: {
      matchups: {
        include: { homeTeam: true, awayTeam: true },
        orderBy: { week: 'asc' },
      },
    },
  });

  if (!schedule) return err('No schedule found', 404);

  return ok(schedule);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const league = await findLeague(id);
  if (!league) return err('League not found', 404);

  try {
    const schedules = await prisma.schedule.findMany({
      where: { leagueId: league.id },
      select: { id: true },
    });

    if (schedules.length === 0) {
      return err('No schedule to delete', 404);
    }

    const scheduleIds = schedules.map((s) => s.id);

    // SQLite doesn't honour ON DELETE CASCADE at the application layer,
    // so we must delete child matchups before the parent schedules.
    await prisma.$transaction([
      prisma.matchup.deleteMany({ where: { scheduleId: { in: scheduleIds } } }),
      prisma.schedule.deleteMany({ where: { id: { in: scheduleIds } } }),
    ]);

    await writeAuditLog('DELETE', league.id, {
      season: league.season,
      schedulesDeleted: schedules.length,
    });

    return ok({ deleted: schedules.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed';
    return err(message);
  }
}
