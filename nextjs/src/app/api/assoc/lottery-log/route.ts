// src/app/api/assoc/lottery-log/route.ts
//
// POST /api/assoc/lottery-log
//
// Records the result of a draft lottery simulation in the audit log.
// Called by the Lottery tab each time the commissioner runs or reruns the
// lottery so every outcome is permanently logged for transparency.
//
// The lottery uses a weighted random draw (1,000,000 total tickets distributed
// by inverse finish position). This endpoint captures the full ticket breakdown
// and each team's assigned pick so the odds and result are fully auditable.
//
// Request body:
//   leagueId — internal league ID
//   results  — one entry per team, with ticket count and the assigned pick
//   rerun    — true if this is a re-run of a previously logged lottery

import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { ok, err } from '@/lib/api';

/** A single team's outcome from the lottery simulation. */
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
    return err('leagueId and results are required', 400);
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

  return ok({ logged: true });
}
