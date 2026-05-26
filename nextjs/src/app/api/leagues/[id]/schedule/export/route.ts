// src/app/api/leagues/[id]/schedule/export/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { err } from '@/lib/api';

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

  const rows = [
    ['week', 'home', 'away', 'type'],
    ...schedule.matchups.map((m) => [
      String(m.week),
      m.homeTeam.name,
      m.awayTeam.name,
      m.type,
    ]),
  ];

  const csv = rows.map((r) => r.join(',')).join('\n');

  await writeAuditLog('EXPORT', id, {
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
