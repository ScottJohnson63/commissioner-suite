// src/app/api/assoc/standings/route.ts
//
// GET /api/assoc/standings?leagueId={internalId}
//
// Returns the final standings from the PREVIOUS season for a given league.
// Used by the Lottery and Divisions tabs to seed draft order and division
// assignments based on last year's playoff results.
//
// Data flow:
//   1. Look up the league in the DB to get the Sleeper league ID.
//   2. Fetch the Sleeper league metadata to find `previous_league_id`.
//   3. Fetch users, rosters, winners bracket, and losers bracket for the
//      previous season in parallel.
//   4. Walk brackets from the final round backwards, assigning ranks 1→N
//      (1 = champion) to each roster in the order they finished.
//   5. Return a StandingEntry[] sorted by rank ascending.
//
// Bracket-rank algorithm:
//   • In the final round, the championship match (both participants came from
//     the winners path) is processed first so ranks flow 1→2→3→4.
//   • Remaining rounds are walked newest-to-oldest so higher finishes get
//     lower rank numbers.
//
// `division` on the returned entries is a placeholder (rank % 2 === 1 ? 1 : 2)
// that the Divisions tab uses as a starting point before the commissioner
// manually adjusts assignments.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sleeperGet } from '@/lib/sleeper/client';
import type { SleeperRoster, SleeperUser, SleeperLeagueRaw } from '@/lib/sleeper/types';
import type { StandingEntry } from '@/types/standings';
import { ok, err } from '@/lib/api';

export type { StandingEntry };

type SleeperLeagueInfo = Pick<SleeperLeagueRaw, 'previous_league_id'>;

/** Describes which prior match a participant advanced from; null = seeded directly. */
type MatchFrom = { w: number } | { l: number } | null;

/** A single match node in a Sleeper bracket, as returned by the API. */
interface BracketMatch {
  /** Round number (1 = earliest, higher = later). */
  r: number;
  /** Match number within the round. */
  m: number;
  /** Roster ID of participant 1 (null if not yet determined). */
  t1: number | null;
  /** Roster ID of participant 2 (null if not yet determined). */
  t2: number | null;
  /** Roster ID of the winner (null if match not yet played). */
  w: number | null;
  /** Roster ID of the loser (null if match not yet played). */
  l: number | null;
  /** Where t1 came from in the bracket. */
  t1_from: MatchFrom;
  /** Where t2 came from in the bracket. */
  t2_from: MatchFrom;
}

/**
 * Derives a final-standings rank map from winners and losers bracket data.
 *
 * Walks each bracket from the final round backwards, assigning sequential
 * integer ranks (1 = best) to each roster in finish order. The championship
 * match in the final round is processed before consolation matches so that
 * winner → rank 1, runner-up → rank 2, third → rank 3, etc.
 *
 * @param winners  Bracket data from /league/{id}/winners_bracket.
 * @param losers   Bracket data from /league/{id}/losers_bracket.
 * @returns        Map of rosterId → final rank.
 */
function rankFromBrackets(winners: BracketMatch[], losers: BracketMatch[]): Map<number, number> {
  const rankMap = new Map<number, number>();
  let nextRank = 1;

  function fromWinner(f: MatchFrom): boolean {
    return f === null || 'w' in f;
  }

  function process(matches: BracketMatch[]): void {
    if (!matches.length) return;
    const maxRound = Math.max(...matches.map((m) => m.r));

    for (let r = maxRound; r >= 1; r--) {
      const round = matches.filter((m) => m.r === r);

      // In the final round: championship match (both from winning path) before
      // consolation match (both from losing path) so ranks flow 1→2→3→4.
      if (r === maxRound) {
        round.sort((a, b) => {
          const aChamp = fromWinner(a.t1_from) && fromWinner(a.t2_from);
          const bChamp = fromWinner(b.t1_from) && fromWinner(b.t2_from);
          return aChamp === bChamp ? a.m - b.m : aChamp ? -1 : 1;
        });
      } else {
        round.sort((a, b) => a.m - b.m);
      }

      for (const match of round) {
        if (match.w !== null && !rankMap.has(match.w)) rankMap.set(match.w, nextRank++);
        if (match.l !== null && !rankMap.has(match.l)) rankMap.set(match.l, nextRank++);
      }
    }
  }

  process(winners);
  process(losers);
  return rankMap;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const leagueId = req.nextUrl.searchParams.get('leagueId');
  if (!leagueId) return err('leagueId is required', 400);

  const league = await prisma.league.findFirst({
    where: { OR: [{ id: leagueId }, { sleeperLeagueId: leagueId }] },
  });
  if (!league) return err('League not found', 404);

  const { previous_league_id } = await sleeperGet<SleeperLeagueInfo>(
    `/league/${league.sleeperLeagueId}`,
  );
  if (!previous_league_id) {
    return err('No previous season found for this league', 404);
  }

  const [users, rosters, winners, losers] = await Promise.all([
    sleeperGet<SleeperUser[]>(`/league/${previous_league_id}/users`),
    sleeperGet<SleeperRoster[]>(`/league/${previous_league_id}/rosters`),
    sleeperGet<BracketMatch[]>(`/league/${previous_league_id}/winners_bracket`),
    sleeperGet<BracketMatch[]>(`/league/${previous_league_id}/losers_bracket`),
  ]);

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const rosterInfo = new Map(
    rosters.map((r) => {
      const u = r.owner_id ? userMap.get(r.owner_id) : undefined;
      return [r.roster_id, {
        name: u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
        ownerName: u?.display_name ?? null,
      }];
    }),
  );

  const rankMap = rankFromBrackets(winners, losers);

  const standings: StandingEntry[] = Array.from(rankMap.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([rosterId, rank]) => {
      const info = rosterInfo.get(rosterId);
      return {
        rank,
        rosterId,
        name: info?.name ?? `Team ${rosterId}`,
        ownerName: info?.ownerName ?? null,
        isChampion: rank === 1,
        division: (rank % 2 === 1 ? 1 : 2) as 1 | 2,
      };
    });

  return ok({ standings });
}
