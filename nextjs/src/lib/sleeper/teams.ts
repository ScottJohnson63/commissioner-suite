// src/lib/sleeper/teams.ts
//
// The single answer to "what is this team called, and who owns it?"
//
// Sleeper spreads that answer across two endpoints: /league/{id}/users holds the
// display names and any custom team name, /league/{id}/rosters holds the roster
// IDs that everything else in this app keys on. Joining them is the most
// duplicated operation in the codebase — before this module it was written out
// seven times, and one of those copies disagreed with the other six about what
// a blank team name means.
//
// Every route that needs a team name should call through here so the rule lives
// in one place. Routes that already hold `users` and `rosters` for other reasons
// use `buildRosterInfo`; routes that need only the names use `fetchRosterInfo`.

import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser } from '@/lib/sleeper/types';

/** A team as this app talks about it: a roster ID with a name and an owner. */
export interface RosterInfo {
  rosterId:  number;
  /** Display name for the team — never empty. */
  name:      string;
  /** The manager's Sleeper display name, or null for an unowned roster. */
  ownerName: string | null;
  /** Sleeper user ID of the owner, or null for an unowned roster. */
  ownerId:   string | null;
}

/**
 * The naming rule, in one place.
 *
 * Prefer the custom team name the manager set in Sleeper, fall back to their
 * display name, and finally to a generic "Team N" label.
 *
 * Managers can save a *blank* team name in Sleeper, so this treats empty and
 * whitespace-only values as absent. That is the detail the old copies disagreed
 * on: `agentContext` used `??`, which only falls through on null, and so
 * rendered an empty label where every other call site rendered the owner's name.
 *
 * @param user      The roster owner's Sleeper user record, if one exists.
 * @param rosterId  Roster ID, used for the last-resort "Team N" label.
 * @param fallback  Overrides that last-resort label. Routes differ here on
 *                  purpose — an empty opponent slot in a matchup report reads
 *                  better as "Unknown" than as "Team 7" — so the label stays a
 *                  caller's choice even though the rule above does not.
 */
export function resolveTeamName(
  user: SleeperUser | undefined,
  rosterId: number | string,
  fallback?: string,
): string {
  return (
    user?.metadata?.team_name?.trim() ||
    user?.display_name?.trim() ||
    fallback ||
    `Team ${rosterId}`
  );
}

/** Indexes league users by their Sleeper user ID. */
export function buildUserMap(users: SleeperUser[] | null | undefined): Map<string, SleeperUser> {
  return new Map((users ?? []).map((u) => [u.user_id, u]));
}

/**
 * Joins users onto rosters, keyed by roster ID.
 *
 * Use this when the caller already has both payloads in hand — several routes
 * fetch them for other reasons and would otherwise pay for the same two calls
 * twice.
 */
export function buildRosterInfo(
  users: SleeperUser[] | null | undefined,
  rosters: SleeperRoster[] | null | undefined,
): Map<number, RosterInfo> {
  const byUserId = buildUserMap(users);

  return new Map(
    (rosters ?? []).map((r) => {
      const user = r.owner_id ? byUserId.get(r.owner_id) : undefined;
      return [
        r.roster_id,
        {
          rosterId:  r.roster_id,
          name:      resolveTeamName(user, r.roster_id),
          ownerName: user?.display_name?.trim() || null,
          ownerId:   r.owner_id ?? null,
        },
      ];
    }),
  );
}

/**
 * Fetches users and rosters for a league and returns the joined team info.
 *
 * @param sleeperLeagueId  Sleeper league ID.
 * @param revalidate       Fetch cache TTL in seconds. Defaults to
 *                         `SLEEPER_TTL.LEAGUE`; pass `SLEEPER_TTL.FRESH` for a
 *                         user-triggered refresh.
 */
export async function fetchRosterInfo(
  sleeperLeagueId: string,
  revalidate: number = SLEEPER_TTL.LEAGUE,
): Promise<Map<number, RosterInfo>> {
  const [users, rosters] = await Promise.all([
    sleeperGet<SleeperUser[]>(`/league/${sleeperLeagueId}/users`, revalidate),
    sleeperGet<SleeperRoster[]>(`/league/${sleeperLeagueId}/rosters`, revalidate),
  ]);
  return buildRosterInfo(users, rosters);
}
