// src/lib/cards/bonus.ts
//
// Bonus packs earned from what a member did in Sleeper the week just gone.
//
// Two rules, each worth one extra pack a week:
//
//   WIN         — won a matchup in any of their Sleeper leagues.
//   HIGH_SCORE  — scored more than HIGH_SCORE_THRESHOLD in any of them.
//
// **Both are read off a finished week, never the one in progress.** Sleeper's
// matchup endpoint reports live points, so during Sunday afternoon a member
// leading by 30 with their opponent's running back still to play satisfies
// didRosterWin, and a single Thursday-night receiver can carry one league past
// the high-score line before the rest of the roster has kicked off. Nothing
// revokes a PackBonus row once written — only a full game reset clears them —
// so a lead that evaporated by the evening still left the pack in the account.
// Scoring the completed week is the only reading the rest of the afternoon
// cannot contradict. See issue #52, and claimBonuses for the two weeks.
//
// "Any" is doing real work in both: a member in four leagues who wins all four
// gets one win pack, not four. That is enforced by the unique key on PackBonus
// rather than by counting here, so two requests racing cannot both award it.
//
// Sleeper is pull-only, so this runs when a member looks at the card page. The
// cost of that is managed in two places: once both bonuses exist for a week
// there is nothing left to win and the check short-circuits without touching
// the network at all, and a short in-process guard stops a page that re-renders
// from re-asking. Everything underneath still goes through sleeperGet, so the
// Next fetch cache collapses bursts on top of that.

import { prisma } from '@/lib/prisma';
import { ensureGrant } from '@/lib/cards/allowance';
import { sleeperGet, SLEEPER_TTL } from '@/lib/sleeper/client';
import type { SleeperMatchupRaw, SleeperRoster } from '@/lib/sleeper/types';
import { RouteCache } from '@/lib/cache';
import { BONUS_KINDS, HIGH_SCORE_THRESHOLD, type BonusKind } from '@/lib/cards/ration';

// The two tunables live in ration.ts, which imports no Prisma, so the Draft
// Deck tour can state the threshold rather than retype it — see the note there.
// Re-exported because this is where every caller already looks for them.
export { BONUS_KINDS, HIGH_SCORE_THRESHOLD } from '@/lib/cards/ration';
export type { BonusKind } from '@/lib/cards/ration';

/** What a member earned, and the league that earned it. */
export interface BonusAward {
  kind: BonusKind;
  sleeperLeagueId: string | null;
  points: number | null;
}

/** A league the member plays in, as /user/{id}/leagues returns it. */
interface SleeperLeagueRaw {
  league_id: string;
  name?: string;
}

/**
 * How long a completed check is trusted before Sleeper is asked again.
 *
 * Only reached when a member is still missing at least one bonus for the week
 * being scored, so this is the rate limit on "have I won yet?" polling. It used
 * to be sized so a live result appeared while someone was still looking at the
 * page; a finished week's result does not change, so what it buys now is the
 * Tuesday case — the week flips while a member has the page open, and two
 * minutes is how long the previous week's "nothing yet" is trusted for.
 */
const CHECK_TTL_MS = 2 * 60 * 1000;

const checkCache = new RouteCache<true>();

/**
 * Decides a matchup from one week's raw entries.
 *
 * Sleeper pairs rosters by `matchup_id` and reports each side's points
 * separately; there is no "winner" field, so it has to be worked out. A null
 * `matchup_id` is a bye, which is not a win — it is nothing happening.
 *
 * Exported for testing: this is the rule that decides whether a pack is owed,
 * and it is easy to get wrong at the edges (ties, byes, a solo entry).
 */
export function didRosterWin(
  entries: readonly SleeperMatchupRaw[],
  rosterId: number,
): boolean {
  const mine = entries.find((e) => e.roster_id === rosterId);
  if (!mine || mine.matchup_id == null) return false;

  const opponents = entries.filter(
    (e) => e.matchup_id === mine.matchup_id && e.roster_id !== rosterId,
  );
  // A pairing with nobody on the other side is a bye, not a victory.
  if (!opponents.length) return false;

  // A tie is not a win. Strict greater-than against every opponent.
  return opponents.every((o) => (mine.points ?? 0) > (o.points ?? 0));
}

/** Points a roster scored in a week, or 0 when it has no entry. */
export function rosterPoints(
  entries: readonly SleeperMatchupRaw[],
  rosterId: number,
): number {
  return entries.find((e) => e.roster_id === rosterId)?.points ?? 0;
}

/**
 * Looks at every league a member plays in and works out what they earned.
 *
 * Stops asking Sleeper as soon as both bonuses are accounted for — there is
 * nothing more to learn once a member has won somewhere and scored a hundred
 * somewhere, so a member in six leagues usually costs two leagues' worth of
 * calls rather than six.
 *
 * Never throws. Sleeper being unreachable means no bonus this minute, not a
 * broken card page: the check simply reports nothing and runs again later.
 */
export async function detectBonuses(
  sleeperUserId: string, season: number, week: number,
): Promise<BonusAward[]> {
  const awards = new Map<BonusKind, BonusAward>();

  try {
    const leagues = await sleeperGet<SleeperLeagueRaw[]>(
      `/user/${sleeperUserId}/leagues/nfl/${season}`,
      SLEEPER_TTL.LEAGUE,
    );
    if (!Array.isArray(leagues) || !leagues.length) return [];

    for (const league of leagues) {
      if (awards.size === BONUS_KINDS.length) break;

      try {
        const [rosters, entries] = await Promise.all([
          sleeperGet<SleeperRoster[]>(`/league/${league.league_id}/rosters`, SLEEPER_TTL.LEAGUE),
          sleeperGet<SleeperMatchupRaw[]>(
            `/league/${league.league_id}/matchups/${week}`,
            SLEEPER_TTL.LEAGUE,
          ),
        ]);

        const mine = rosters?.find((r) => r.owner_id === sleeperUserId);
        if (!mine || !Array.isArray(entries) || !entries.length) continue;

        const points = rosterPoints(entries, mine.roster_id);

        if (!awards.has('WIN') && didRosterWin(entries, mine.roster_id)) {
          awards.set('WIN', { kind: 'WIN', sleeperLeagueId: league.league_id, points });
        }
        if (!awards.has('HIGH_SCORE') && points > HIGH_SCORE_THRESHOLD) {
          awards.set('HIGH_SCORE', {
            kind: 'HIGH_SCORE', sleeperLeagueId: league.league_id, points,
          });
        }
      } catch {
        // One unreachable league must not cost the member the others.
        continue;
      }
    }
  } catch {
    // No leagues, or Sleeper down. Nothing earned, nothing broken.
    return [];
  }

  return [...awards.values()];
}

export interface BonusResult {
  /** Bonuses newly awarded by this call. */
  awarded: BonusAward[];
  /** Every bonus held for the scored week, including ones awarded earlier. */
  kinds: BonusKind[];
  /**
   * The completed week these were scored from, or null when no week has
   * finished yet. Returned rather than recomputed by the caller so the rule for
   * "is there a finished week?" lives in one place.
   */
  week: number | null;
}

/**
 * Checks Sleeper and grants any bonus packs the member has earned.
 *
 * Two weeks, and they are not interchangeable:
 *
 *   `scoredWeek`  — the week whose results decide the award. The last
 *                   *completed* week, never the one in progress, for the reason
 *                   at the top of this file: live points pay out on a lead
 *                   rather than on a win.
 *   `creditWeek`  — the grant the pack lands on: the current week. Same rule as
 *                   claimWildcard, and for the same reason — packs on a grant a
 *                   member can no longer reach are not a prize.
 *
 * The PackBonus row is keyed on the week that earned it. That is what makes the
 * award once-per-week, and it is also why this change needs no backfill: rows
 * written by the old live-week behaviour already sit under the week they were
 * scored from, so a member who was paid early for week 3 is simply held to have
 * week 3's packs and is not paid again.
 *
 * The grant is two writes that must not drift apart: a PackBonus row recording
 * *why*, and an increment on the week's bonus pack count. The PackBonus insert
 * goes first and is allowed to fail — its unique key is what makes the award
 * once-per-week — and the counter is only incremented for inserts that actually
 * happened. That ordering is why two concurrent page loads cannot hand out the
 * same pack twice.
 */
export async function claimBonuses(
  userId: string, sleeperUserId: string | null,
  season: number, scoredWeek: number, creditWeek: number,
): Promise<BonusResult> {
  // No finished week to read. resolveWeeks floors the completed week at 1, so
  // in NFL week 1 both readings are week 1 — and scoring week 1 while week 1 is
  // being played is the bug this guard exists to prevent. An explicit ?week=
  // lands here too, which is right: asking about one named week is a view, not
  // a claim.
  if (scoredWeek >= creditWeek) return { awarded: [], kinds: [], week: null };

  const existing = await prisma.packBonus.findMany({
    where:  { userId, gameSeason: season, week: scoredWeek },
    select: { kind: true },
  });
  const held = new Set(existing.map((b) => b.kind as BonusKind));

  // Everything already earned — no reason to ask Sleeper anything.
  if (held.size === BONUS_KINDS.length || !sleeperUserId) {
    return { awarded: [], kinds: [...held], week: scoredWeek };
  }

  const cacheKey = `${userId}:${season}:${scoredWeek}`;
  if (checkCache.get(cacheKey, CHECK_TTL_MS)) {
    return { awarded: [], kinds: [...held], week: scoredWeek };
  }
  checkCache.set(cacheKey, true);

  const detected = await detectBonuses(sleeperUserId, season, scoredWeek);
  const fresh = detected.filter((a) => !held.has(a.kind));
  if (!fresh.length) return { awarded: [], kinds: [...held], week: scoredWeek };

  const awarded: BonusAward[] = [];
  for (const award of fresh) {
    try {
      await prisma.packBonus.create({
        data: {
          userId, gameSeason: season, week: scoredWeek,
          kind: award.kind,
          sleeperLeagueId: award.sleeperLeagueId,
          points: award.points,
        },
      });
      awarded.push(award);
      held.add(award.kind);
    } catch {
      // Lost the race — another request awarded this one. Not an error, and
      // deliberately not counted, so the pack is granted exactly once.
      held.add(award.kind);
    }
  }

  if (awarded.length) {
    // The grant row is created lazily, on whoever reads it first — and reading
    // a finished week means this now usually runs on the member's first visit
    // of the new week, before anything has created it. Without this the
    // increment would match no row and the pack would evaporate, while the
    // PackBonus row recording it stayed behind to block ever earning it again.
    await ensureGrant(userId, season, creditWeek);
    await prisma.packGrant.updateMany({
      where: { userId, gameSeason: season, week: creditWeek },
      // The pre-rolled tier is deliberately left alone. It used to be cleared
      // here, because a bonus pack had a Silver floor and a tier rolled before
      // the bonus existed could be Bronze. A bonus pack is an ordinary pack
      // now, so the stored tier is already valid for it — and discarding it
      // would take away the wrapper the member had been looking at.
      data: { bonusGranted: { increment: awarded.length } },
    });
  }

  return { awarded, kinds: [...held], week: scoredWeek };
}
