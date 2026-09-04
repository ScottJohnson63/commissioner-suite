// src/lib/sleeper/playerCache.ts
//
// Fetches the Sleeper NFL player map (https://api.sleeper.app/v1/players/nfl)
// and caches it in-memory + DB. The Sleeper docs say this endpoint should be
// called at most once per 24 h — this module is the only place in the app that
// calls it, and it enforces that limit on four levels:
//
//   1. In-memory cache      — no DB round trip within the process.
//   2. Single-flight        — concurrent callers join one download.
//   3. DB data row          — survives restarts, shared across instances.
//   4. DB attempt row       — claimed *before* the download, so a failure or a
//                             cold-start stampede cannot retry it either.
//
// When the day's slot is spent and the stored map is stale, the stale map is
// served rather than refreshed. Names change slowly; the rate limit does not.

import { prisma } from '@/lib/prisma';
import { SLEEPER_BASE, SLEEPER_TTL, SLEEPER_USER_AGENT } from '@/lib/sleeper/client';

const CACHE_KEY = 'nfl_players';
// Records that a download was *attempted*, separately from the data itself, so
// a failed attempt still consumes the day's budget. See claimDailyFetch().
const ATTEMPT_KEY = 'nfl_players_fetch_attempt';
const ONE_DAY_MS = SLEEPER_TTL.PLAYERS * 1000;
// How long a stale map is served from memory before the DB is consulted again —
// long enough to keep the DB off the request path, short enough to pick up
// another instance's refresh.
const STALE_RECHECK_MS = 15 * 60 * 1000;
// The payload is ~10 MB; an un-aborted fetch would pin every caller waiting on
// this one download until the platform kills the function.
const FETCH_TIMEOUT_MS = 20 * 1000;
const SLEEPER_PLAYERS_URL = `${SLEEPER_BASE}/players/nfl`;

export interface SleeperPlayerInfo {
  name: string;        // full_name (or first_name + last_name)
  position: string;   // QB | RB | WR | TE | K | DEF | …
  team: string | null; // NFL team abbreviation, null if free agent / retired
  gsisId: string | null; // NFL GSIS ID (e.g. "00-0034796") — used to cross-reference
                          // the local NflWeeklyStat DB which stores nflverse/GSIS IDs
}

// Module-level in-memory cache so the DB is only hit once per process restart.
let memCache: Map<string, SleeperPlayerInfo> | null = null;
// Absolute time at which memCache stops being served — a full day for fresh
// data, a short recheck window for stale data served past its refresh.
let memCacheUntil = 0;
// Last download attempt made by this process. The DB row is the real guard;
// this is the backstop for when the DB itself is unreachable.
let lastAttemptTs = 0;

/**
 * The one in-flight refresh, when there is one.
 *
 * Every panel on the dashboard asks for this map, and on a cold process none of
 * them has a cache to hit — so without this they each start their own download
 * of the largest payload Sleeper serves, of the one endpoint Sleeper explicitly
 * asks callers to hit at most once a day. The in-memory cache above only helps
 * once the first download has *finished*; concurrent callers arrive before that.
 * They wait on the first request instead.
 */
let inFlight: Promise<Map<string, SleeperPlayerInfo>> | null = null;

/**
 * `getPlayerMap()` that never rejects.
 *
 * Four routes join player names onto Sleeper data and treat a missing player map
 * as cosmetic — they would rather render IDs than fail the request. Each of them
 * had its own `.catch(() => new Map())`; this is that decision in one place.
 */
export async function getPlayerMapSafe(): Promise<Map<string, SleeperPlayerInfo>> {
  return getPlayerMap().catch(() => new Map<string, SleeperPlayerInfo>());
}

/**
 * Returns a Map<player_id, SleeperPlayerInfo>.
 *
 * Resolution order:
 *   1. In-memory (fastest — same process, <24 h old)
 *   2. A load already in flight (concurrent callers wait rather than duplicate)
 *   3. SleeperCache DB row (survives server restarts, <24 h old)
 *   4. Sleeper API (at most once per 24 h)
 */
export async function getPlayerMap(): Promise<Map<string, SleeperPlayerInfo>> {
  // ── 1. In-memory ────────────────────────────────────────────────────────────
  if (memCache && Date.now() < memCacheUntil) {
    return memCache;
  }

  // ── 1b. A refresh already running ───────────────────────────────────────────
  // Join it rather than starting a second one. See `inFlight` above.
  if (inFlight) return inFlight;

  inFlight = loadPlayerMap();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Takes the day's single download slot, or refuses.
 *
 * The slot is claimed in the DB *before* the network call, not after it
 * succeeds, because the ways this endpoint gets hammered are all failure
 * paths: a Sleeper outage, a timeout, a write-back error, or a fleet of cold
 * serverless instances that each find no cache. Recording the attempt makes a
 * failed download cost the same as a successful one — one call, then nothing
 * until tomorrow.
 *
 * @returns true if the caller may download, false if today's slot is spent.
 */
async function claimDailyFetch(now: number): Promise<boolean> {
  if (now - lastAttemptTs < ONE_DAY_MS) return false;
  try {
    const row = await prisma.sleeperCache.findUnique({ where: { key: ATTEMPT_KEY } });
    if (row) {
      const attemptedAt = new Date(row.fetchedAt).getTime();
      if (now - attemptedAt < ONE_DAY_MS) {
        lastAttemptTs = attemptedAt;   // adopt the fleet-wide stamp
        return false;
      }
    }
    await prisma.sleeperCache.upsert({
      where:  { key: ATTEMPT_KEY },
      update: { data: new Date(now).toISOString(), fetchedAt: new Date(now) },
      create: { key: ATTEMPT_KEY, data: new Date(now).toISOString(), fetchedAt: new Date(now) },
    });
  } catch {
    // The DB is unreachable, so the claim cannot be shared across instances.
    // The in-process stamp below still holds this instance to once a day.
  }
  lastAttemptTs = now;
  return true;
}

/** The actual DB-then-API load. Only ever one of these runs at a time. */
async function loadPlayerMap(): Promise<Map<string, SleeperPlayerInfo>> {
  const now = Date.now();

  // ── 2. DB cache ──────────────────────────────────────────────────────────────
  let stale: string | null = null;
  try {
    const row = await prisma.sleeperCache.findUnique({ where: { key: CACHE_KEY } });
    if (row) {
      const age = now - new Date(row.fetchedAt).getTime();
      if (age < ONE_DAY_MS) {
        const map = parsePlayerJson(row.data);
        memCache = map;
        memCacheUntil = new Date(row.fetchedAt).getTime() + ONE_DAY_MS;
        return map;
      }
      stale = row.data;   // past its refresh, but far better than nothing
    }
  } catch {
    // DB read failed — fall through to API fetch
  }

  // Serving yesterday's names beats spending a second download on today's.
  const serveStale = (): Map<string, SleeperPlayerInfo> => {
    const map = parsePlayerJson(stale as string);
    memCache = map;
    memCacheUntil = now + STALE_RECHECK_MS;
    return map;
  };

  // ── 3. Sleeper API — at most once per day, fleet-wide ────────────────────────
  if (!(await claimDailyFetch(now))) {
    if (stale) return serveStale();
    throw new Error('Sleeper player map unavailable — today\'s refresh has already been used');
  }

  let raw: string;
  try {
    const res = await fetch(SLEEPER_PLAYERS_URL, {
      next: { revalidate: SLEEPER_TTL.PLAYERS },
      headers: { 'User-Agent': SLEEPER_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Sleeper players API ${res.status}`);
    raw = await res.text();
  } catch (fetchErr) {
    // The slot is spent either way; salvage the answer if we can.
    if (stale) return serveStale();
    throw fetchErr;
  }

  // Persist to DB (non-fatal if it fails)
  try {
    await prisma.sleeperCache.upsert({
      where: { key: CACHE_KEY },
      update: { data: raw, fetchedAt: new Date() },
      create: { key: CACHE_KEY, data: raw, fetchedAt: new Date() },
    });
  } catch {
    // ignore — in-memory will still serve subsequent requests
  }

  const map = parsePlayerJson(raw);
  memCache = map;
  memCacheUntil = now + ONE_DAY_MS;
  return map;
}

function parsePlayerJson(json: string): Map<string, SleeperPlayerInfo> {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const map = new Map<string, SleeperPlayerInfo>();

  for (const [id, p] of Object.entries(raw)) {
    if (!p || typeof p !== 'object') continue;
    const player = p as Record<string, unknown>;

    const name: string =
      (player.full_name as string | undefined) ??
      (player.first_name && player.last_name ? `${player.first_name as string} ${player.last_name as string}` : '');

    if (!name.trim()) continue; // skip placeholder entries

    // Sleeper ships 22% of its gsis_id values with a leading space (" 00-0035700").
    // Untrimmed they are truthy but match nothing in NflWeeklyStat, which is worse
    // than absent: the player looks resolved and silently scores zero, instead of
    // falling through to the name lookup. Blank becomes null for the same reason.
    const rawGsis = (player.gsis_id as string | null | undefined)?.trim();

    map.set(id, {
      name,
      position: (player.position as string | undefined) ?? (player.fantasy_positions as string[] | undefined)?.[0] ?? '',
      team:     (player.team    as string | null | undefined) ?? null,
      gsisId:   rawGsis ? rawGsis : null,
    });
  }

  return map;
}
