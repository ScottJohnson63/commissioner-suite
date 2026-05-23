// src/app/api/trending/route.ts

import { NextRequest, NextResponse } from 'next/server';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// Sleeper trending response shape
interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

interface TrendingPlayer {
  player_id: string;
  count: number;
  type: 'add' | 'drop';
}

async function fetchTrending(
  type: 'add' | 'drop',
  sport: string,
  lookbackHours: number,
  limit: number,
): Promise<SleeperTrendingPlayer[]> {
  const url = `${SLEEPER_BASE}/players/${sport}/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`;

  const res = await fetch(url, {
    next: { revalidate: 300 }, // cache for 5 minutes — trending data doesn't change per-second
  });

  if (!res.ok) {
    throw new Error(`Sleeper trending API error ${res.status} for type=${type}`);
  }

  return res.json() as Promise<SleeperTrendingPlayer[]>;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const sport = searchParams.get('sport') ?? 'nfl';
  const type = searchParams.get('type'); // 'add' | 'drop' | null (null = both)
  const lookbackHours = Number(searchParams.get('lookback_hours') ?? '24');
  const limit = Math.min(Number(searchParams.get('limit') ?? '25'), 100); // cap at 100

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

  try {
    if (type === 'add' || type === 'drop') {
      // Single type requested
      const players = await fetchTrending(type, sport, lookbackHours, limit);
      const result: TrendingPlayer[] = players.map((p) => ({ ...p, type }));
      return NextResponse.json(result);
    }

    // No type specified — return both adds and drops in parallel
    const [adds, drops] = await Promise.all([
      fetchTrending('add', sport, lookbackHours, limit),
      fetchTrending('drop', sport, lookbackHours, limit),
    ]);

    return NextResponse.json({
      adds: adds.map((p) => ({ ...p, type: 'add' as const })),
      drops: drops.map((p) => ({ ...p, type: 'drop' as const })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}