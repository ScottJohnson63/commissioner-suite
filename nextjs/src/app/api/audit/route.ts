// src/app/api/audit/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId') ?? undefined;
  const limitParam = searchParams.get('limit');
  const take = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

  try {
    const raw = await prisma.auditLog.findMany({
      where: leagueId ? { leagueId } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        league: {
          select: { id: true, name: true, season: true, sleeperLeagueId: true },
        },
      },
    });
    const logs = raw.map((l) => ({
      ...l,
      detail: (() => { try { return JSON.parse(l.detail) as Record<string, unknown>; } catch { return {}; } })(),
    }));
    return NextResponse.json(logs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch audit logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
