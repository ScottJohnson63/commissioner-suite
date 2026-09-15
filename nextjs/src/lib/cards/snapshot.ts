// src/lib/cards/snapshot.ts
//
// The whole-pool facts the Draft Deck page needs on every load, cached in the
// database instead of recounted per request.
//
// Three numbers on the collection response — the seasons the pool spans, how
// many cards it holds, and the split by tier — are each a question about an
// entire table, and they were each asked on every page load:
//
//   * `availableSeasons()` runs `SELECT DISTINCT season FROM NflWeeklyStat`.
//     There is no index on `season` alone (the only one that leads with it is
//     `@@unique([season, week, playerId])`), so SQLite walks the whole thing —
//     on the order of **448,000 rows to return about 27 integers**.
//   * `cardDefinition.count()` and the `groupBy(['tier'])` behind the pool page
//     each scan the ~14,000-row pool.
//
// Turso bills row reads, and that is what emptied the plan's allowance: a
// single Draft Deck load cost roughly half a million of them, and the answer
// never changed between two loads a second apart. The database refused reads
// outright once the quota went, which is what a member saw as a raw
// "SQL read operations are forbidden" on the page.
//
// So they are measured once and written to a `SleeperCache` row, which brings a
// page load down to **one row read**. This is the fix docs/CARDS.md already
// proposed for the pool scan ("store the pool as a single JSON blob in
// SleeperCache — one row read instead of fourteen thousand"), applied to the
// cheaper facts about the pool rather than to the pool itself.
//
// Why the database and not RouteCache: an in-process cache is defeated by
// serverless cold starts, which is exactly the condition under which these
// scans were running. A row is shared by every Function instance and survives
// every restart. The in-process memo below sits in front of it so repeat calls
// inside one request — the collection route asks for the seasons and the
// allowance asks for the pool size, concurrently — cost nothing.
//
// **Staleness is bounded by the rebuild, not by the clock.** Every fact here
// changes only when `rebuildCardPool` runs, and the route that runs it drops
// this row in the same breath. `MAX_AGE_MS` is a safety net for the rebuild
// that happened somewhere this process cannot see — the CLI script, say — not
// the mechanism. Nothing here counts anything a member owns: `claimed` moves
// on every pack in the league and stays a live count in currentAllowance.

import { prisma } from '@/lib/prisma';
import { availableSeasons } from '@/lib/cards/pool';

/** Everything about the pool that is true until the next rebuild. */
export interface PoolFacts {
  /** Seasons the stat table holds, oldest first. */
  seasons: number[];
  /** Cards in the pool, claimed or not. */
  poolSize: number;
  /** How the pool splits by tier, keyed by CardTier. */
  byTier: Record<string, number>;
}

const CACHE_KEY = 'card_pool_facts';

/**
 * How long a stored row is trusted.
 *
 * A day, because the only thing that can invalidate it without saying so is a
 * rebuild run outside a request — and one of those is a deliberate act a
 * commissioner is watching, not a background drift.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let memo: { facts: PoolFacts; until: number } | null = null;

/**
 * The read in flight, if there is one.
 *
 * The collection route asks for the seasons and the pack allowance in the same
 * `Promise.all`, so two callers reach a cold memo together. Without this they
 * would each run the scans this module exists to avoid.
 */
let inFlight: Promise<PoolFacts> | null = null;

/** Whether a parsed blob is still shaped like what this module writes. */
function isPoolFacts(value: unknown): value is PoolFacts {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<PoolFacts>;
  return Array.isArray(v.seasons)
    && v.seasons.every((s) => typeof s === 'number')
    && typeof v.poolSize === 'number'
    && typeof v.byTier === 'object' && v.byTier !== null;
}

/** The expensive path: two whole-table scans, run as rarely as possible. */
async function measure(): Promise<PoolFacts> {
  const [seasons, byTierRows] = await Promise.all([
    availableSeasons(),
    prisma.cardDefinition.groupBy({ by: ['tier'], _count: true }),
  ]);

  const byTier = Object.fromEntries(byTierRows.map((r) => [r.tier, r._count]));
  // Summed rather than counted separately: the groupBy has already walked every
  // row, and a second `count()` would walk them again for a number it implies.
  const poolSize = Object.values(byTier).reduce((n, c) => n + c, 0);

  return { seasons, poolSize, byTier };
}

/** Measures, stores and memoises. Writing the row is best-effort. */
async function refresh(now: number): Promise<PoolFacts> {
  const facts = await measure();
  memo = { facts, until: now + MAX_AGE_MS };

  try {
    const data = JSON.stringify(facts);
    await prisma.sleeperCache.upsert({
      where:  { key: CACHE_KEY },
      update: { data, fetchedAt: new Date() },
      create: { key: CACHE_KEY, data, fetchedAt: new Date() },
    });
  } catch {
    // A pool read must not fail because its cache could not be written. The
    // memo still spares the rest of this process.
  }

  return facts;
}

/**
 * The pool facts — from memory, then from the cache row, then by measuring.
 *
 * A stored row that cannot be read or parsed is treated as absent rather than
 * as an error: the scans are slow, not broken, and falling back to them is
 * always correct.
 */
export async function poolFacts(): Promise<PoolFacts> {
  const now = Date.now();
  if (memo && now < memo.until) return memo.facts;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const row = await prisma.sleeperCache.findUnique({ where: { key: CACHE_KEY } });
      if (row) {
        const storedAt = new Date(row.fetchedAt).getTime();
        if (now - storedAt < MAX_AGE_MS) {
          const parsed: unknown = JSON.parse(row.data);
          if (isPoolFacts(parsed)) {
            memo = { facts: parsed, until: storedAt + MAX_AGE_MS };
            return parsed;
          }
        }
      }
    } catch {
      // Cache miss by another name — fall through and measure.
    }
    return refresh(now);
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Just the seasons, for callers that want nothing else. */
export async function poolSeasons(): Promise<number[]> {
  return (await poolFacts()).seasons;
}

/**
 * Drops the cached facts. Call after anything that rewrites CardDefinition.
 *
 * Deletes the row rather than rewriting it, so the next reader measures. The
 * memo is cleared in this process only — other instances are covered by the row
 * being gone, which is the reason the row exists rather than a RouteCache.
 */
export async function invalidatePoolFacts(): Promise<void> {
  memo = null;
  try {
    await prisma.sleeperCache.deleteMany({ where: { key: CACHE_KEY } });
  } catch {
    // Non-fatal: MAX_AGE_MS still expires it, and a rebuild that fails to clear
    // its cache is not a reason to report the rebuild itself as failed.
  }
}

/** Empties the in-process memo. Exists for tests — see RouteCache.clearAll. */
export function __resetPoolFactsMemo(): void {
  memo = null;
  inFlight = null;
}
