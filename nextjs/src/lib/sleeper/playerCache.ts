// src/lib/sleeper/playerCache.ts
//
// Fetches the Sleeper NFL player map (https://api.sleeper.app/v1/players/nfl)
// and caches it in-memory + DB. The Sleeper docs say this endpoint should be
// called at most once per 24 h — we enforce that limit here.

import { prisma } from '@/lib/prisma';
import { SLEEPER_BASE } from '@/lib/sleeper/client';

const CACHE_KEY = 'nfl_players';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SLEEPER_PLAYERS_URL = `${SLEEPER_BASE}/players/nfl`;

export interface SleeperPlayerInfo {
  name: string;        // full_name (or first_name + last_name)
  position: string;   // QB | RB | WR | TE | K | DEF | …
  team: string | null; // NFL team abbreviation, null if free agent / retired
}

// Module-level in-memory cache so the DB is only hit once per process restart.
let memCache: Map<string, SleeperPlayerInfo> | null = null;
let memCacheTs = 0;

/**
 * Returns a Map<player_id, SleeperPlayerInfo>.
 * Resolution order:
 *   1. In-memory (fastest — same process, <24 h old)
 *   2. SleeperCache DB row (survives server restarts, <24 h old)
 *   3. Sleeper API (at most once per 24 h)
 */
export async function getPlayerMap(): Promise<Map<string, SleeperPlayerInfo>> {
  const now = Date.now();

  // ── 1. In-memory ────────────────────────────────────────────────────────────
  if (memCache && now - memCacheTs < ONE_DAY_MS) {
    return memCache;
  }

  // ── 2. DB cache ──────────────────────────────────────────────────────────────
  try {
    const row = await prisma.sleeperCache.findUnique({ where: { key: CACHE_KEY } });
    if (row) {
      const age = now - new Date(row.fetchedAt).getTime();
      if (age < ONE_DAY_MS) {
        const map = parsePlayerJson(row.data);
        memCache = map;
        memCacheTs = new Date(row.fetchedAt).getTime();
        return map;
      }
    }
  } catch {
    // DB read failed — fall through to API fetch
  }

  // ── 3. Sleeper API ───────────────────────────────────────────────────────────
  const res = await fetch(SLEEPER_PLAYERS_URL, {
    next: { revalidate: 86400 }, // also seed Next.js fetch cache for 24 h
    headers: { 'User-Agent': 'CommissionerSuite/1.0 (fantasy-league-manager)' },
  });
  if (!res.ok) throw new Error(`Sleeper players API ${res.status}`);
  const raw = await res.text();

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
  memCacheTs = now;
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePlayerJson(json: string): Map<string, SleeperPlayerInfo> {
  const raw = JSON.parse(json) as Record<string, any>;
  const map = new Map<string, SleeperPlayerInfo>();

  for (const [id, p] of Object.entries(raw)) {
    if (!p || typeof p !== 'object') continue;

    const name: string =
      (p.full_name as string | undefined) ??
      (p.first_name && p.last_name ? `${p.first_name as string} ${p.last_name as string}` : '');

    if (!name.trim()) continue; // skip placeholder entries

    map.set(id, {
      name,
      position: (p.position as string | undefined) ?? (p.fantasy_positions as string[] | undefined)?.[0] ?? '',
      team: (p.team as string | null | undefined) ?? null,
    });
  }

  return map;
}
