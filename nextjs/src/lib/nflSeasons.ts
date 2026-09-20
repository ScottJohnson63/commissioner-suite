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
// **The invalidation comes from the sync side, not from here.** NflWeeklyStat is
// written only by the sync scripts under python/scripts — sync_nfl_weekly.py,
// backfill_nfl_seasons.py, load_completed_season.py, sync_nfl_defense.py —
// never by this app, so there is no write on this side to hook. Those scripts
// delete this row after a run instead; see python/scripts/common/appcache.py.
// The age limit below is the backstop for a delete that could not reach the
// database, not the whole mechanism. Waiting it out was: a season's first stats
// stayed invisible to the Statistics tab for up to a day after they landed.

import { prisma } from '@/lib/prisma';
import { DbCache } from '@/lib/dbCache';

/** A day. The backstop behind the sync-side eviction described above. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isSeasonList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((s) => typeof s === 'number');
}

/**
 * The scan itself. Oldest first — see the note on ordering below.
 *
 * Team defenses are excluded from what counts as a season having stats. They
 * are not nflverse player rows: sync_nfl_defense.py assembles them from the
 * team feed and writes them under `position = 'DEF'` with fantasy points left
 * NULL, and it syncs the live season from the calendar. So the moment a season
 * kicks off it has 32 DEF rows and nothing else, which was enough to put it in
 * this list, make it the Statistics tab's default, and leave that tab reading
 * "No data available" on the fantasy-points leaderboard it opens on — the whole
 * of issue #98. A season joins the list when it has players in it.
 */
async function measureSeasons(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ season: number }[]>`
    SELECT DISTINCT season FROM NflWeeklyStat
    WHERE position IS NULL OR position <> 'DEF'
    ORDER BY season
  `;
  // Number() because Turso's Hrana JSON protocol encodes integers as strings —
  // see the note on the HTTP client in docs/CARDS.md.
  return rows.map((r) => Number(r.season));
}

/** Key of the cached row. Must match STAT_SEASONS_KEY in common/appcache.py. */
export const STAT_SEASONS_CACHE_KEY = 'nfl_stat_seasons';

const cache = new DbCache<number[]>(
  STAT_SEASONS_CACHE_KEY, MAX_AGE_MS, measureSeasons, isSeasonList,
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
