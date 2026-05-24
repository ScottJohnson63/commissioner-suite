// src/app/api/sleeper/matchups/route.ts
//
// Fetches and joins three Sleeper endpoints to produce ready-to-render matchup pairs:
//   /league/{id}/matchups/{week}  — points + matchup_id per roster
//   /league/{id}/rosters          — maps roster_id → owner_id
//   /league/{id}/users            — maps owner_id → display_name / team_name
//
// Cached for 5 minutes per league+week combination.

import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api.sleeper.app/v1';
const TTL = 5 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SleeperMatchupRaw {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  starters_points?: number[];
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
  };
}

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

export interface MatchupTeam {
  rosterId: number;
  ownerId: string | null;
  teamName: string;
  displayName: string;
  points: number;
  wins: number;
  losses: number;
}

export interface MatchupPair {
  matchupId: number;
  home: MatchupTeam;
  away: MatchupTeam;
}

// ─── Simple in-process cache ──────────────────────────────────────────────────

interface CacheEntry {
  data: MatchupPair[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();

async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Sleeper ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const week = Number(searchParams.get('week') ?? '1');

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 });
  }
  if (isNaN(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: 'week must be 1–18' }, { status: 400 });
  }

  const key = `${leagueId}:${week}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const [matchupsRaw, rosters, users] = await Promise.all([
      sleeperGet<SleeperMatchupRaw[]>(`/league/${leagueId}/matchups/${week}`),
      sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
      sleeperGet<SleeperUser[]>(`/league/${leagueId}/users`),
    ]);

    // Build lookup maps
    const rosterById = new Map(rosters.map((r) => [r.roster_id, r]));
    const userById = new Map(users.map((u) => [u.user_id, u]));

    function buildTeam(raw: SleeperMatchupRaw): MatchupTeam {
      const roster = rosterById.get(raw.roster_id);
      const user = roster?.owner_id ? userById.get(roster.owner_id) : undefined;
      const displayName = user?.display_name ?? `Roster ${raw.roster_id}`;
      const teamName =
        user?.metadata?.team_name?.trim() || displayName;
      return {
        rosterId: raw.roster_id,
        ownerId: roster?.owner_id ?? null,
        teamName,
        displayName,
        points: raw.points ?? 0,
        wins: roster?.settings?.wins ?? 0,
        losses: roster?.settings?.losses ?? 0,
      };
    }

    // Group by matchup_id
    const grouped = new Map<number, SleeperMatchupRaw[]>();
    for (const m of matchupsRaw) {
      if (m.matchup_id === null) continue;
      const arr = grouped.get(m.matchup_id) ?? [];
      arr.push(m);
      grouped.set(m.matchup_id, arr);
    }

    const pairs: MatchupPair[] = [];
    for (const [matchupId, entries] of grouped) {
      if (entries.length < 2) continue;
      pairs.push({
        matchupId,
        home: buildTeam(entries[0]),
        away: buildTeam(entries[1]),
      });
    }

    pairs.sort((a, b) => a.matchupId - b.matchupId);
    cache.set(key, { data: pairs, ts: Date.now() });

    return NextResponse.json(pairs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
