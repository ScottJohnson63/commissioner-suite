// src/lib/sleeper/sync.ts

import { Team } from '@/lib/scheduler/types';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

interface SleeperLeague {
  league_id: string;
  season: string;
  settings: {
    divisions: number;
  };
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  settings: {
    division: number; // 1-indexed
  };
}

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: {
    team_name?: string; // set if owner customized their team name
  };
}

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Sleeper API error ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLeagueData(leagueId: string): Promise<{
  leagueId: string;
  season: number;
  teams: Team[];
}> {
  const [league, rosters, users] = await Promise.all([
    sleeperFetch<SleeperLeague>(`/league/${leagueId}`),
    sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    sleeperFetch<SleeperUser[]>(`/league/${leagueId}/users`),
  ]);

  if (league.settings.divisions !== 2) {
    throw new Error(
      `Expected 2 divisions, league has ${league.settings.divisions}`,
    );
  }

  const userMap = new Map(users.map((u) => [u.user_id, u]));

  const teams: Team[] = rosters.map((roster) => {
    const user = userMap.get(roster.owner_id);
    const name =
      user?.metadata?.team_name ??
      user?.display_name ??
      `Team ${roster.roster_id}`;

    return {
      id: String(roster.roster_id),
      name,
      divisionId: (roster.settings.division - 1) as 0 | 1,
    };
  });

  return {
    leagueId: league.league_id,
    season: Number(league.season),
    teams,
  };
}