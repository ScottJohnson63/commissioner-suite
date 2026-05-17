// src/app/api/leagues/[id]/schedule/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSchedule } from '@/lib/scheduler/engine';
import { Team } from '@/lib/scheduler/types';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    include: { teams: true },
  });

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

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

    return NextResponse.json({ scheduleId: saved.id, matchupCount: saved.matchups.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
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

  if (!schedule) return NextResponse.json({ error: 'No schedule found' }, { status: 404 });

  return NextResponse.json(schedule);
}