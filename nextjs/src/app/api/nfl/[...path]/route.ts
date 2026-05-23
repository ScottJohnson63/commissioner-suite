// src/app/api/nfl/[...path]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const { searchParams } = req.nextUrl;
  const endpoint = path[0];

  try {
    switch (endpoint) {
      case 'weekly': {
        const season = Number(searchParams.get('season') ?? '2025');
        const week = searchParams.get('week')
          ? Number(searchParams.get('week'))
          : undefined;
        const position = searchParams.get('position') ?? undefined;

        const stats = await prisma.nflWeeklyStat.findMany({
          where: {
            season,
            ...(week !== undefined && { week }),
            ...(position !== undefined && { position }),
          },
          orderBy: [{ week: 'desc' }, { fantasyPointsPpr: 'desc' }],
        });

        return NextResponse.json(stats);
      }

      case 'players': {
        const season = Number(searchParams.get('season') ?? '2025');
        const position = searchParams.get('position') ?? undefined;

        const players = await prisma.nflWeeklyStat.findMany({
          where: {
            season,
            ...(position !== undefined && { position }),
          },
          distinct: ['playerId'],
          select: {
            playerId: true,
            playerName: true,
            playerDisplayName: true,
            position: true,
            positionGroup: true,
            team: true,
            headshot: true,
          },
          orderBy: { playerDisplayName: 'asc' },
        });

        return NextResponse.json(players);
      }

      default:
        return NextResponse.json(
          { error: `Unknown endpoint: ${endpoint}` },
          { status: 404 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}