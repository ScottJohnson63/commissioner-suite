// src/app/api/leagues/[id]/schedule/export/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { err } from '@/lib/api';
import { findLeagueByAnyId } from '@/lib/league';
import { teamNameResolver } from '@/lib/sleeper/liveNames';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Resolve by DB id or Sleeper league id — matches the schedule route's behaviour.
  const league = await findLeagueByAnyId(id);
  if (!league) return err('League not found', 404);

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

  // An export leaves the building, so it is the worst place to ship a stale
  // name. Same overlay as the schedule endpoint.
  const nameFor = await teamNameResolver(league.sleeperLeagueId);

  const rows = [
    ['week', 'home', 'away', 'type'],
    ...schedule.matchups.map((m) => [
      String(m.week),
      nameFor(m.homeTeam.sleeperRosterId, m.homeTeam.name),
      nameFor(m.awayTeam.sleeperRosterId, m.awayTeam.name),
      m.type,
    ]),
  ];

  const csv = rows.map((r) => r.join(',')).join('\n');

  await writeAuditLog('EXPORT', league.id, {
    scheduleId: schedule.id,
    season: schedule.season,
    matchupCount: schedule.matchups.length,
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="schedule-${schedule.season}.csv"`,
    },
  });
}
