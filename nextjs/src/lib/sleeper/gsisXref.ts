// src/lib/sleeper/gsisXref.ts
//
// Sleeper player IDs → nflverse GSIS IDs.
//
// Rosters, matchups and the trending feed all speak Sleeper's numeric IDs
// ("11566"). NflWeeklyStat is keyed on nflverse GSIS IDs ("00-0034796"). The two
// never coincide, so any stat query built from a Sleeper roster returns zero
// rows unless the IDs are translated first — silently, since an empty result and
// "this player scored nothing" look identical downstream.
//
// Sleeper publishes a `gsis_id` per player, but it is populated for well under a
// quarter of rostered players (33 of 179 in a real 10-team league) — Jayden
// Daniels, D'Andre Swift and George Pickens all have none. The cross-reference
// IDs Sleeper carries for other providers (espn_id, yahoo_id, pfr_id) are no
// better. So `gsis_id` is the preferred key and a normalised name match against
// the stat table is the fallback, which together resolve every rostered player
// who has stats at all: the remainder are true rookies and players who missed the
// whole season.
//
// Team defenses skip all of it. nflverse publishes no DEF rows, so they are
// assembled by a sync of their own and stored under the team abbreviation —
// which is also Sleeper's DEF player id, making the mapping an identity.

import { prisma } from '@/lib/prisma';
import type { SleeperPlayerInfo } from '@/lib/sleeper/playerCache';
import { statsCodeOf } from '@/lib/nflTeams';

/** Name suffixes that one source carries and the other drops. */
const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

/**
 * Reduces a player name to a comparison key: lowercase, no accents, no
 * punctuation, no generational suffix, no spaces.
 *
 * "Marvin Harrison Jr." and "Marvin Harrison" both become "marvinharrison", so
 * the two feeds agree regardless of which one carries the suffix.
 */
export function normalizePlayerName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(SUFFIXES, '')
    .replace(/\s+/g, '');
}

export interface GsisXref {
  /** Sleeper player ID → GSIS ID, for the players that resolved. */
  toGsis:   Map<string, string>;
  /** GSIS ID → Sleeper player ID. The inverse, for mapping query rows back. */
  toSleeper: Map<string, string>;
  /** The resolved GSIS IDs, ready to hand to a `playerId: { in: … }` filter. */
  gsisIds:  string[];
}

/** Per-season name index, memoised — it only changes when a sync adds a player. */
const CACHE_TTL_MS = 5 * 60_000;
const nameIndexCache = new Map<number, { value: NameIndex; ts: number }>();

interface NameIndex {
  /** "normalisedname|POS" → GSIS ID. */
  byNameAndPos: Map<string, string>;
  /** normalised name → GSIS ID, only where that name is unique in the season. */
  byUniqueName: Map<string, string>;
}

/**
 * Builds the Sleeper → GSIS translation for a set of Sleeper player IDs.
 *
 * @param sleeperIds  Sleeper player IDs from a roster, matchup or trending feed.
 * @param playerMap   Sleeper's player map, from `getPlayerMapSafe()`.
 * @param season      Season whose stat rows the name fallback matches against —
 *                    pass the resolved stats season, not the live one, or the
 *                    index will be empty before kickoff.
 */
export async function buildGsisXref(
  sleeperIds: string[],
  playerMap:  Map<string, SleeperPlayerInfo>,
  season:     number,
): Promise<GsisXref> {
  const toGsis    = new Map<string, string>();
  const toSleeper = new Map<string, string>();

  const needName: string[] = [];
  for (const id of sleeperIds) {
    // A team defense is filed under its team abbreviation rather than a GSIS id,
    // which is also Sleeper's DEF player id — so the translation is usually the
    // identity. Usually, not always: nflverse writes the Rams as LA where
    // Sleeper says LAR, and an identity mapping there finds no rows at all and
    // projects the defense at zero.
    if (playerMap.get(id)?.position === 'DEF') {
      const statsId = statsCodeOf(id) ?? id;
      if (!toSleeper.has(statsId)) {
        toGsis.set(id, statsId);
        toSleeper.set(statsId, id);
      }
      continue;
    }

    // Trimmed again here, not only at the parse boundary: a whitespace-padded ID
    // is truthy but joins to nothing, so it would resolve the player to a query
    // that returns no rows rather than sending him to the name lookup.
    const gsisId = playerMap.get(id)?.gsisId?.trim();
    if (!gsisId) {
      needName.push(id);
      continue;
    }
    // First writer wins. Two Sleeper entries claiming one GSIS ID would
    // otherwise have the second silently take the first one's stats when the
    // rows are mapped back.
    if (toSleeper.has(gsisId)) continue;
    toGsis.set(id, gsisId);
    toSleeper.set(gsisId, id);
  }

  if (needName.length > 0) {
    const index = await nameIndex(season);
    for (const id of needName) {
      const info = playerMap.get(id);
      if (!info) continue;
      const key = normalizePlayerName(info.name);
      if (!key) continue;

      // Position first. Falling back to a name-only hit covers the handful of
      // players the two feeds list at different positions (a two-way player, or
      // someone Sleeper has already moved to a new role), and is only consulted
      // when that name belongs to exactly one player in the season.
      const gsisId = index.byNameAndPos.get(`${key}|${info.position}`)
        ?? index.byUniqueName.get(key);
      if (!gsisId || toSleeper.has(gsisId)) continue;

      toGsis.set(id, gsisId);
      toSleeper.set(gsisId, id);
    }
  }

  return { toGsis, toSleeper, gsisIds: [...toGsis.values()] };
}

/** Loads (and memoises) the season's name → GSIS index from the stat table. */
async function nameIndex(season: number): Promise<NameIndex> {
  const hit = nameIndexCache.get(season);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const byNameAndPos = new Map<string, string>();
  const byUniqueName = new Map<string, string>();

  try {
    // groupBy, not findMany+distinct: Prisma applies `distinct` in memory, so
    // the season's ~19k stat rows would all cross the wire to build a ~2k entry
    // index. Grouping pushes the DISTINCT into SQL and fetches only the index.
    const rows = await prisma.nflWeeklyStat.groupBy({
      by:    ['playerId', 'playerDisplayName', 'position'],
      where: { season, playerDisplayName: { not: null } },
    });

    // A name seen under two different GSIS IDs is ambiguous, so it is withheld
    // from the name-only map rather than resolved to whichever came first.
    const ambiguous = new Set<string>();
    for (const row of rows) {
      const key = normalizePlayerName(row.playerDisplayName);
      if (!key) continue;

      byNameAndPos.set(`${key}|${row.position ?? ''}`, row.playerId);

      const seen = byUniqueName.get(key);
      if (seen && seen !== row.playerId) ambiguous.add(key);
      else byUniqueName.set(key, row.playerId);
    }
    for (const key of ambiguous) byUniqueName.delete(key);
  } catch {
    // No index means the gsis_id path still works; the rest degrade to zeros.
  }

  const value: NameIndex = { byNameAndPos, byUniqueName };
  nameIndexCache.set(season, { value, ts: Date.now() });
  return value;
}

/** Test seam — drops the memoised name indexes. */
export function clearGsisXrefCache(): void {
  nameIndexCache.clear();
}
