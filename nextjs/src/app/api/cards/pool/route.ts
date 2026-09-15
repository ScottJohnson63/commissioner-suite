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
//
// AUTH: GET  user
// AUTH: POST commissioner

import { NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireCommissioner, requireUser } from '@/lib/apiAuth';
import { writeAuditLog } from '@/lib/audit';
import { rebuildCardPool } from '@/lib/cards/pool';
import { PACKS_PER_WEEK, gameSeason } from '@/lib/cards/allowance';
import { invalidatePoolFacts, poolFacts } from '@/lib/cards/snapshot';
import { invalidatePoolCache } from '@/lib/cards/service';

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  try {
    // All three pool numbers come off one cached row. They used to be a
    // `count()`, a `DISTINCT season` over the stat table and a `groupBy` — three
    // whole-table scans for three answers that only change when the rebuild
    // below runs, which is what POST invalidates. See lib/cards/snapshot.ts.
    const { poolSize, seasons, byTier } = await poolFacts();

    return ok({
      // The season the game is being played in. The commissioner page reads it
      // from here rather than paying for a whole collection fetch just to put
      // a year in the reset confirmation.
      gameSeason: gameSeason(),
      poolSize,
      // The ration is a flat constant, so it is read as one. Deriving it from
      // currentAllowance() meant counting every ownership row and every member
      // to report a number that is neither.
      perWeek: PACKS_PER_WEEK,
      seasons,
      byTier,
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
    // And the cached facts still describe the pool that was here a moment ago —
    // its size, its tier split and the seasons it spanned. Dropped rather than
    // recomputed: the next reader measures, and only if there is one.
    await invalidatePoolFacts();

    // GENERATE rather than SYNC: nothing left the building, this derived a new
    // pool from data already here. Not league-scoped — the pool is NFL-wide.
    await writeAuditLog('GENERATE', null, {
      operation: 'card-pool-rebuild',
      seasons: result.seasons,
      cardsBySeason: result.cardsBySeason,
      total: result.total,
      perWeek: PACKS_PER_WEEK,
    });

    return ok({ ...result, perWeek: PACKS_PER_WEEK });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rebuild pool';
    return err(message, 500);
  }
}
