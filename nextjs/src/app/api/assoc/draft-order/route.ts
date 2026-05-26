import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';

interface DraftPick {
  pick: number;
  rosterId: number;
  name: string;
  ownerName: string | null;
  source: 'lottery' | 'standings';
  prevRank: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { leagueId?: string; draftOrder?: DraftPick[] };

  if (!body.leagueId || !Array.isArray(body.draftOrder)) {
    return NextResponse.json({ error: 'leagueId and draftOrder are required' }, { status: 400 });
  }

  await writeAuditLog('GENERATE', body.leagueId, {
    type: 'draft_order',
    picks: body.draftOrder.map((p) => ({
      pick: p.pick,
      rosterId: p.rosterId,
      name: p.name,
      ownerName: p.ownerName,
      source: p.source,
      prevRank: p.prevRank,
    })),
  });

  return NextResponse.json({ logged: true });
}
