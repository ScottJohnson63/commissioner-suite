// src/app/api/sleeper/matchups/route.ts
//
// Fetches and joins three Sleeper endpoints to produce ready-to-render matchup pairs:
//   /league/{id}/matchups/{week}  — points + matchup_id per roster
//   /league/{id}/rosters          — maps roster_id → owner_id
//   /league/{id}/users            — maps owner_id → display_name / team_name
//
// Cached for 5 minutes per league+week combination.

import { NextRequest, NextResponse } from 'next/server';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperMatchupRaw, SleeperRoster, SleeperUser } from '@/lib/sleeper/types';
import { RouteCache } from '@/lib/cache';
import { ok, err } from '@/lib/api';

const TTL = 5 * 60 * 1000;

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

const cache = new RouteCache<MatchupPair[]>();

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const leagueId = searchParams.get('leagueId')?.trim();
  const week = Number(searchParams.get('week') ?? '1');

  if (!leagueId) {
    return err('leagueId is required', 400);
  }
  if (isNaN(week) || week < 1 || week > 18) {
    return err('week must be 1–18', 400);
  }

  const key = `${leagueId}:${week}`;
  const cached = cache.get(key, TTL);
  if (cached) return ok(cached);

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
    cache.set(key, pairs);

    return ok(pairs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Upstream error';
    const status = msg.includes('404') ? 404 : 502;
    return err(msg, status);
  }
}
