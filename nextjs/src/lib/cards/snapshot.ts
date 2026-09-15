// src/lib/cards/snapshot.ts
//
// The whole-pool facts the Draft Deck page needs on every load, cached in the
// database instead of recounted per request.
//
// Three numbers on the collection response — the seasons the pool spans, how
// many cards it holds, and the split by tier — are each a question about an
// entire table, and they were each asked on every page load:
//
//   * the season list, a scan of ~448,000 stat rows for about two dozen
//     integers (lib/nflSeasons.ts owns that one now, and owns the explanation);
//   * `cardDefinition.count()` and the `groupBy(['tier'])` behind the pool page,
//     each a scan of the ~14,000-row pool.
//
// Turso bills row reads, and that is what emptied the plan's allowance: a single
// Draft Deck load cost roughly half a million of them, and the answer never
// changed between two loads a second apart. The database refused reads outright
// once the quota went, which is what a member saw as a raw "SQL read operations
// are forbidden" on the page.
//
// So they are measured once and written to a `SleeperCache` row, which brings a
// page load down to one row read. This is the fix docs/CARDS.md already proposed
// for the pool scan ("store the pool as a single JSON blob in SleeperCache —
// one row read instead of fourteen thousand"), applied to the cheaper facts
// about the pool rather than to the pool itself.
//
// lib/dbCache.ts owns the mechanics — the row, the in-process memo, the
// single-flighting, and the rule that a measurement overtaken by an
// invalidation is never published. This module is only what to measure and when
// to drop it.
//
// **Staleness is bounded by the rebuild, not by the clock.** Every fact here
// changes only when `rebuildCardPool` runs, and both callers that run it —
// POST /api/cards/pool and prisma/rebuild-pool.ts — drop this row in the same
// breath. The maximum age is a safety net, not the mechanism.
//
// Nothing here counts anything a member owns: `claimed` moves on every pack in
// the league and stays a live count in currentAllowance.

import { prisma } from '@/lib/prisma';
import { DbCache } from '@/lib/dbCache';
import { statSeasons } from '@/lib/nflSeasons';

/** Everything about the pool that is true until the next rebuild. */
export interface PoolFacts {
  /** Seasons the stat table holds, oldest first. */
  seasons: number[];
  /** Cards in the pool, claimed or not. */
  poolSize: number;
  /** How the pool splits by tier, keyed by CardTier. */
  byTier: Record<string, number>;
}

/**
 * A day — but see the note above: the rebuild is what actually evicts this, and
 * this only covers a rebuild run somewhere the caches cannot see.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether a parsed blob is still shaped like what this module writes. */
function isPoolFacts(value: unknown): value is PoolFacts {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<PoolFacts>;
  return Array.isArray(v.seasons)
    && v.seasons.every((s) => typeof s === 'number')
    && typeof v.poolSize === 'number'
    && typeof v.byTier === 'object' && v.byTier !== null;
}

/** The expensive path, run as rarely as possible. */
async function measure(): Promise<PoolFacts> {
  const [seasons, byTierRows] = await Promise.all([
    // Cached in its own right, and by its own trigger — a stat backfill, not a
    // pool rebuild. See the note at the top of lib/nflSeasons.ts.
    statSeasons(),
    prisma.cardDefinition.groupBy({ by: ['tier'], _count: true }),
  ]);

  const byTier = Object.fromEntries(byTierRows.map((r) => [r.tier, r._count]));
  // Summed rather than counted separately: the groupBy has already walked every
  // row, and a second `count()` would walk them again for a number it implies.
  const poolSize = Object.values(byTier).reduce((n, c) => n + c, 0);

  return { seasons, poolSize, byTier };
}

const cache = new DbCache<PoolFacts>(
  'card_pool_facts', MAX_AGE_MS, measure, isPoolFacts,
);

/** The pool facts — from memory, then from the cache row, then by measuring. */
export async function poolFacts(): Promise<PoolFacts> {
  return cache.read();
}

/** Just the seasons, for callers that want nothing else. */
export async function poolSeasons(): Promise<number[]> {
  return (await cache.read()).seasons;
}

/**
 * Drops the cached facts. Call after anything that rewrites CardDefinition.
 *
 * This also cancels a measurement already in flight. A rebuild does `deleteMany`
 * and then ~70 chunked inserts, so a `measure()` that overlaps it can see an
 * empty or half-written pool; without the cancellation that reading would land
 * in the row *after* this delete and pin a wrong pool size for the full maximum
 * age, on every instance. See DbCache.refresh.
 */
export async function invalidatePoolFacts(): Promise<void> {
  await cache.invalidate();
}

/** Empties the in-process memo. Exists for tests — see RouteCache.clearAll. */
export function __resetPoolFactsMemo(): void {
  cache.resetMemo();
}
