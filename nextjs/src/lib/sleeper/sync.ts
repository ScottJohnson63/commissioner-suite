// src/lib/sleeper/sync.ts
//
// Fetches the minimal set of Sleeper data needed to upsert a league record and
// its teams into the local database. Called by POST /api/leagues/sync.
//
// Three Sleeper endpoints are fetched in parallel:
//   /league/{id}          — league metadata (name, season, division settings)
//   /league/{id}/rosters  — one entry per team with the owner's user_id
//   /league/{id}/users    — display names and custom team names
//
// This module enforces the invariant that every synced league has exactly
// 2 divisions (the scheduler engine requires it). If the league is configured
// differently in Sleeper, syncing will throw rather than produce corrupt data.

import { Team } from '@/lib/scheduler/types';
import { sleeperGet } from '@/lib/sleeper/client';

/** Minimal roster shape needed for a sync — only fields we actually use. */
interface SyncRoster {
  roster_id: number;
  owner_id: string;
  /** `division` is 1-indexed in the Sleeper API; we convert to 0-indexed internally. */
  settings: { division: number };
}

/** Minimal user shape needed for a sync. */
interface SyncUser {
  user_id: string;
  display_name: string;
  /** Custom team name set by the manager in Sleeper, if any. */
  metadata?: { team_name?: string };
}

/**
 * Fetches league metadata and roster/user data from the Sleeper API and
 * returns them in the shape expected by the local database upsert logic.
 *
 * @param leagueId  Sleeper league ID (numeric string, e.g. "123456789").
 * @returns  Structured data ready for the `prisma.league.upsert` call in
 *           POST /api/leagues/sync.
 * @throws   `Error` if the league does not have exactly 2 divisions.
 */
export async function fetchLeagueData(leagueId: string): Promise<{
  leagueId: string;
  name: string;
  season: number;
  teams: Team[];
}> {
  interface LeagueShape { league_id: string; name: string; season: string; settings: { divisions: number } }
  const [league, rosters, users] = await Promise.all([
    sleeperGet<LeagueShape>(`/league/${leagueId}`),
    sleeperGet<SyncRoster[]>(`/league/${leagueId}/rosters`),
    sleeperGet<SyncUser[]>(`/league/${leagueId}/users`),
  ]);

  // The schedule generator is hard-coded for 2-division, 10-team leagues.
  // Reject leagues that don't match before any data is written.
  if (league.settings.divisions !== 2) {
    throw new Error(
      `Expected 2 divisions, league has ${league.settings.divisions}`,
    );
  }

  const userMap = new Map(users.map((u) => [u.user_id, u]));

  const teams: Team[] = rosters.map((roster) => {
    const user = userMap.get(roster.owner_id);
    // Prefer the custom team name the manager set in Sleeper, fall back to their
    // display name, and finally to a generic "Team N" label.
    const name =
      user?.metadata?.team_name ??
      user?.display_name ??
      `Team ${roster.roster_id}`;

    return {
      id: String(roster.roster_id),
      name,
      // Sleeper divisions are 1-indexed; the scheduler uses 0-indexed (0 | 1).
      divisionId: (roster.settings.division - 1) as 0 | 1,
    };
  });

  return {
    leagueId: league.league_id,
    name: league.name,
    season: Number(league.season),
    teams,
  };
}