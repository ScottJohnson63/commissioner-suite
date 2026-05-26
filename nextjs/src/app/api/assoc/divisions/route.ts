import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import type { StandingEntry } from '@/app/api/assoc/standings/route';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { leagueId?: string; standings?: StandingEntry[] };

  if (!body.leagueId || !Array.isArray(body.standings) || body.standings.length === 0) {
    return NextResponse.json({ error: 'leagueId and standings are required' }, { status: 400 });
  }

  const { leagueId, standings } = body;

  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  await Promise.all(
    standings.map((s) =>
      prisma.team.updateMany({
        where: { leagueId, sleeperRosterId: String(s.rosterId) },
        data: { divisionId: s.division - 1 },
      }),
    ),
  );

  await writeAuditLog('GENERATE', leagueId, {
    type: 'divisions',
    teamCount: standings.length,
    divisions: standings.map((s) => ({ rosterId: s.rosterId, name: s.name, division: s.division })),
  });

  return NextResponse.json({ updated: standings.length });
}
