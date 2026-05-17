// src/app/api/leagues/[id]/schedule/export/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = await params;

  const schedule = await prisma.schedule.findFirst({
    where: { leagueId: params.id },
    orderBy: { generatedAt: 'desc' },
    include: {
      matchups: {
        include: { homeTeam: true, awayTeam: true },
        orderBy: { week: 'asc' },
      },
    },
  });

  if (!schedule) return NextResponse.json({ error: 'No schedule found' }, { status: 404 });

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

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="schedule-${schedule.season}.csv"`,
    },
  });
}