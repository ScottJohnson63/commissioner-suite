// src/app/api/leagues/[id]/schedule/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/scheduler/engine';
import { Team } from '@/lib/scheduler/types';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    include: { teams: true },
  });

  if (!league) return err('League not found', 404);

  const teams: Team[] = league.teams.map((t) => ({
    id: t.id,
    name: t.name,
    divisionId: t.divisionId as 0 | 1,
  }));

  const seed = Math.floor(Math.random() * 1_000_000);

  try {
    const schedule = generateSchedule(league.sleeperLeagueId, league.season, teams);

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

  const schedule = await prisma.schedule.findFirst({
    where: { leagueId: id },
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

  const league = await prisma.league.findUnique({ where: { id } });
  if (!league) return err('League not found', 404);

  try {
    const schedules = await prisma.schedule.findMany({
      where: { leagueId: id },
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

    const count = schedules.length;

    await writeAuditLog('DELETE', league.id, {
      season: league.season,
      schedulesDeleted: count,
    });

    return ok({ deleted: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed';
    return err(message);
  }
}
