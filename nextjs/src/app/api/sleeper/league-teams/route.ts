// src/app/api/sleeper/league-teams/route.ts
//
// GET /api/sleeper/league-teams?leagueId={sleeperLeagueId}
//
// Returns the roster list for a Sleeper league so the UI can offer a team
// picker. Unlike /api/assoc/standings this does not depend on playoff brackets
// or a previous season, so it works for any league at any point in the year.
//
// Team name resolution matches the standings route: the manager's custom team
// name if set, otherwise their display name, otherwise a "Team N" placeholder.
//
// Pass `refresh=1` to bypass the 5-minute Sleeper fetch cache. The Lottery tab
// sends this from its Resync button so a manager who just joined shows up
// immediately instead of after the cache expires.

import { NextRequest, NextResponse } from 'next/server';
import { SLEEPER_TTL } from '@/lib/sleeper/client';
import { fetchRosterInfo } from '@/lib/sleeper/teams';
import type { SleeperLeagueTeam } from '@/types/lottery';
import { ok, err } from '@/lib/api';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim();
  if (!leagueId) return err('leagueId is required', 400);

  const revalidate = req.nextUrl.searchParams.get('refresh') === '1'
    ? SLEEPER_TTL.FRESH
    : SLEEPER_TTL.LEAGUE;

  try {
    const info = await fetchRosterInfo(leagueId, revalidate);

    const teams: SleeperLeagueTeam[] = [...info.values()]
      .map(({ rosterId, name, ownerName }) => ({ rosterId, name, ownerName }))
      .sort((a, b) => a.rosterId - b.rosterId);

    return ok({ teams });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch league teams';
    return err(message, message.includes('404') ? 404 : 502);
  }
}
