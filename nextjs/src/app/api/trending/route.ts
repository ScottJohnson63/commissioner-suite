// src/app/api/trending/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getPlayerMap } from '@/lib/sleeper/playerCache';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

export interface TrendingPlayer {
  player_id: string;
  count: number;
  type: 'add' | 'drop';
  name: string | null;
  position: string | null;
  team: string | null;
}

// ── Server-side Sleeper rate-limit guard ──────────────────────────────────────
//
// Trending data is aggregate over 24 h — it changes slowly. We cache each
// endpoint response for 10 minutes and enforce a minimum 10-minute interval
// between real upstream requests. Requests that arrive while the window is
// still open receive the cached (possibly slightly stale) value immediately.
//
// This means Sleeper sees at most 2 requests per 10-minute window from this
// server regardless of how many users are hitting /api/trending.

const TRENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  data: SleeperTrendingPlayer[];
  fetchedAt: number;
}

const trendingCache = new Map<string, CacheEntry>();
const trendingLastFetch = new Map<string, number>();

async function fetchFromSleeper(
  url: string,
): Promise<SleeperTrendingPlayer[]> {
  const now = Date.now();
  const cached = trendingCache.get(url);
  const lastFetch = trendingLastFetch.get(url) ?? 0;

  // Fresh — return immediately
  if (cached && now - cached.fetchedAt < TRENDING_TTL_MS) {
    return cached.data;
  }

  // Stale but rate-limit window still open — serve stale rather than hit Sleeper
  if (cached && now - lastFetch < TRENDING_TTL_MS) {
    console.warn(`[trending] rate-limit guard: serving stale cache for ${url}`);
    return cached.data;
  }

  trendingLastFetch.set(url, now);

  const res = await fetch(url, {
    next: { revalidate: 600 }, // 10 min — also seeds Next.js fetch cache
  });

  if (!res.ok) {
    throw new Error(`Sleeper trending API error ${res.status}`);
  }

  const data = (await res.json()) as SleeperTrendingPlayer[];
  trendingCache.set(url, { data, fetchedAt: now });
  return data;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const sport = searchParams.get('sport') ?? 'nfl';
  const type = searchParams.get('type'); // 'add' | 'drop' | null (null = both)
  const lookbackHours = Number(searchParams.get('lookback_hours') ?? '24');
  const limit = Math.min(Number(searchParams.get('limit') ?? '25'), 100);

  if (isNaN(lookbackHours) || lookbackHours < 1 || lookbackHours > 168) {
    return NextResponse.json(
      { error: 'lookback_hours must be between 1 and 168' },
      { status: 400 },
    );
  }

  if (type !== null && type !== 'add' && type !== 'drop') {
    return NextResponse.json(
      { error: 'type must be "add" or "drop"' },
      { status: 400 },
    );
  }

  function buildUrl(t: 'add' | 'drop'): string {
    return `${SLEEPER_BASE}/players/${sport}/trending/${t}?lookback_hours=${lookbackHours}&limit=${limit}`;
  }

  try {
    // Fetch trending player IDs + player map in parallel
    const [trendingResult, playerMap] = await Promise.all([
      type === 'add' || type === 'drop'
        ? fetchFromSleeper(buildUrl(type)).then((players) => ({ single: { players, type } }))
        : Promise.all([fetchFromSleeper(buildUrl('add')), fetchFromSleeper(buildUrl('drop'))]).then(
            ([adds, drops]) => ({ both: { adds, drops } }),
          ),
      getPlayerMap().catch(() => new Map()), // player map failure is non-fatal
    ]);

    function enrich(p: SleeperTrendingPlayer, t: 'add' | 'drop'): TrendingPlayer {
      const info = playerMap.get(p.player_id);
      return {
        player_id: p.player_id,
        count: p.count,
        type: t,
        name: info?.name ?? null,
        position: info?.position ?? null,
        team: info?.team ?? null,
      };
    }

    if ('single' in trendingResult) {
      const { players, type: t } = trendingResult.single;
      return NextResponse.json(players.map((p) => enrich(p, t as 'add' | 'drop')));
    }

    const { adds, drops } = trendingResult.both;
    return NextResponse.json({
      adds: adds.map((p) => enrich(p, 'add')),
      drops: drops.map((p) => enrich(p, 'drop')),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}