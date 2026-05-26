import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';

interface LotteryResult {
  rosterId: number;
  name: string;
  ownerName: string | null;
  prevRank: number;
  count: number;
  pick: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { leagueId?: string; results?: LotteryResult[]; rerun?: boolean };

  if (!body.leagueId || !Array.isArray(body.results)) {
    return NextResponse.json({ error: 'leagueId and results are required' }, { status: 400 });
  }

  await writeAuditLog('GENERATE', body.leagueId, {
    type: 'lottery',
    rerun: body.rerun ?? false,
    totalDraws: 1_000_000,
    picks: body.results.map((r) => ({
      pick: r.pick,
      rosterId: r.rosterId,
      name: r.name,
      ownerName: r.ownerName,
      prevRank: r.prevRank,
      count: r.count,
    })),
  });

  return NextResponse.json({ logged: true });
}
