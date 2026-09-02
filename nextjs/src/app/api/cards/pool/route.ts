// src/app/api/cards/pool/route.ts
//
// The card pool itself, as opposed to anybody's collection.
//
//   GET  — what the pool currently holds. Readable by any signed-in member, so
//          the game page can show "1,832 cards across 3 seasons".
//   POST — rebuild it from NflWeeklyStat. Commissioner only.
//
// The rebuild is the step that connects the game to the stat syncs: after a
// season is backfilled or a weekly sync corrects a number, this is what turns
// that into cards. It is safe to run at any time — collections survive it.

import { NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireCommissioner, requireUser } from '@/lib/apiAuth';
import { writeAuditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { availableSeasons, rebuildCardPool } from '@/lib/cards/pool';
import { currentAllowance } from '@/lib/cards/allowance';
import { invalidatePoolCache } from '@/lib/cards/service';

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  try {
    const [{ poolSize, perWeek }, seasons, byTier] = await Promise.all([
      currentAllowance(),
      availableSeasons(),
      prisma.cardDefinition.groupBy({ by: ['tier'], _count: true }),
    ]);

    return ok({
      poolSize,
      perWeek,
      seasons,
      byTier: Object.fromEntries(byTier.map((t) => [t.tier, t._count])),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read pool';
    return err(message, 500);
  }
}

export async function POST(): Promise<NextResponse> {
  const denied = await requireCommissioner();
  if (denied) return denied;

  try {
    const result = await rebuildCardPool();
    // The in-process pool cache still holds the ids this rebuild just replaced.
    invalidatePoolCache();

    const { perWeek } = await currentAllowance();

    // GENERATE rather than SYNC: nothing left the building, this derived a new
    // pool from data already here. Not league-scoped — the pool is NFL-wide.
    await writeAuditLog('GENERATE', null, {
      operation: 'card-pool-rebuild',
      seasons: result.seasons,
      cardsBySeason: result.cardsBySeason,
      total: result.total,
      perWeek,
    });

    return ok({ ...result, perWeek });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rebuild pool';
    return err(message, 500);
  }
}
