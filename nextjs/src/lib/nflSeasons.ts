// src/lib/nflSeasons.ts
//
// Which seasons the stat table actually holds — cached, because asking is
// expensive out of all proportion to the answer.
//
// `SELECT DISTINCT season FROM NflWeeklyStat` has no index to lean on: the only
// one that leads with `season` is `@@unique([season, week, playerId])`, so
// SQLite walks the whole table. That is on the order of **448,000 row reads to
// return about two dozen integers**, and Turso bills every one of them. Two
// places wanted that list on every request — the Draft Deck's collection fetch
// and the Statistics tab's season picker — which is most of how the database
// came to refuse reads outright.
//
// **Why this is separate from the card pool's cached facts.** The pool facts in
// lib/cards/snapshot.ts are dropped when a commissioner rebuilds CardDefinition.
// That is the wrong trigger for this list: these seasons are a fact about
// NflWeeklyStat, not about the pool derived from it. Folding them together
// meant a stat backfill stayed invisible until somebody rebuilt the pool, and
// tied the Statistics tab — which has nothing to do with the card game — to the
// card game's invalidation. So snapshot.ts consumes this rather than duplicating
// the scan, and each is invalidated by the thing that actually changes it.
//
// **This one has no invalidator, deliberately.** NflWeeklyStat is written only
// by the sync scripts under python/scripts — sync_nfl_weekly.py,
// backfill_nfl_seasons.py, load_completed_season.py — never by this app, so
// there is no write here to hook. The age limit below is the whole mechanism.
// That is sound because it is the *set* of seasons being cached, not their
// contents: a weekly sync adds rows to a season already in the list and changes
// nothing here. The list moves when a new season's first stats land or a
// backfill completes, which is a once-a-year event either way. Do not go
// looking for the missing `invalidate` call — a day is an acceptable lag on a
// fact that changes annually, and a mid-season sync does not move it at all.

import { prisma } from '@/lib/prisma';
import { DbCache } from '@/lib/dbCache';

/** A day. See the note above on why nothing shortens this. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isSeasonList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((s) => typeof s === 'number');
}

/** The scan itself. Oldest first — see the note on ordering below. */
async function measureSeasons(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ season: number }[]>`
    SELECT DISTINCT season FROM NflWeeklyStat ORDER BY season
  `;
  // Number() because Turso's Hrana JSON protocol encodes integers as strings —
  // see the note on the HTTP client in docs/CARDS.md.
  return rows.map((r) => Number(r.season));
}

const cache = new DbCache<number[]>(
  'nfl_stat_seasons', MAX_AGE_MS, measureSeasons, isSeasonList,
);

/**
 * Seasons with stats, **oldest first**.
 *
 * Ordered this way because that is what the card pool builder and the seasons
 * dropdown on the Draft Deck expect. The Statistics tab's picker wants newest
 * first and reverses a copy — one canonical order here beats two cached lists.
 */
export async function statSeasons(): Promise<number[]> {
  return cache.read();
}

/** Seasons with stats, newest first. */
export async function statSeasonsDescending(): Promise<number[]> {
  return [...(await cache.read())].reverse();
}

/** Empties the in-process memo. Exists for tests. */
export function __resetStatSeasonsMemo(): void {
  cache.resetMemo();
}
