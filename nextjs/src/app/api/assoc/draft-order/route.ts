// src/app/api/assoc/draft-order/route.ts
//
// POST /api/assoc/draft-order
//
// Records the final draft order (derived from the lottery + inverse-standings
// logic) in the audit log so the Activity Log page shows a durable, timestamped
// copy of who picks when.
//
// Note: draft order is NOT stored in a dedicated table — it is reconstructed
// from the audit log whenever it needs to be displayed. This avoids a schema
// migration while still giving commissioners a permanent record.
//
// Request body:
//   leagueId   — internal league ID
//   draftOrder — ordered array of DraftPick objects (pick 1 = first pick)
//
// Each pick captures the team name, roster ID, and where the pick originated
// (lottery winner vs. inverse-standings placement) for full transparency.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';

/** A single pick slot in the draft order, as submitted by the Lottery tab UI. */
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
    return err('leagueId and draftOrder are required', 400);
  }

  const league = await prisma.league.findFirst({
    where: { OR: [{ id: body.leagueId }, { sleeperLeagueId: body.leagueId }] },
    select: { id: true },
  });

  await writeAuditLog('GENERATE', league?.id ?? body.leagueId, {
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

  return ok({ logged: true });
}
