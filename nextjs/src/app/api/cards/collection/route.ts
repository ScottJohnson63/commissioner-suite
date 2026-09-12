// src/app/api/cards/collection/route.ts
//
// GET — everything the card game page needs on load: the member's deck, how it
// scores against the rest of the league, and how many packs they have left.
//
// This is also where Sleeper is checked for bonus packs. It runs before the
// allowance is read, deliberately: a bonus awarded on this request has to be
// reflected in the pack count the same response reports, or a member would win
// a pack and not see it until they refreshed.
//
// That check needs both readings of the week, which is why it resolves them
// together: the *completed* week is what decides whether a bonus was earned,
// and the *current* week is the grant it is paid onto. Scoring the week in
// progress paid out on a Sunday-afternoon lead — see issue #52 and the note at
// the top of lib/cards/bonus.ts.
//
// And it is where last week's starters are swept out of the lineup. Cards
// retire the moment their week locks, so on Tuesday morning a member's slots
// are still pointing at nine cards that can never start again. There is no
// scheduled job to clear them — the pack grant and the starter grant are both
// created the first time a member looks, and this follows the same pattern.
//
// Signed-in members only. The collection is per-user by definition, so there is
// no public view to fall back to.
//
// AUTH: GET user

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { prisma } from '@/lib/prisma';
import { HIGH_SCORE_THRESHOLD, claimBonuses } from '@/lib/cards/bonus';
import { resolveWeeks } from '@/lib/sleeper/week';
import { gameSeason } from '@/lib/cards/allowance';
import { readAllowance, readDeck } from '@/lib/cards/service';
import { clearRetiredSlots, readWeeklyState } from '@/lib/cards/weekly';
import { availableSeasons } from '@/lib/cards/pool';
import { toRosterDtos } from '@/lib/cards/rosterDto';
import type { BonusStateDto, CollectionResponse } from '@/types/cards';

/**
 * Checks Sleeper for bonus packs, resolving the member's Sleeper account first.
 *
 * A member with no linked Sleeper id simply earns nothing — the card game does
 * not require one, and a missing link is a normal state rather than an error.
 *
 * `scoredWeek` is the week the results come from and `creditWeek` the week the
 * packs land on; claimBonuses owns why they differ.
 */
async function claimBonusesFor(
  userId: string, season: number, scoredWeek: number, creditWeek: number,
): Promise<BonusStateDto> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { sleeperUserId: true },
  });

  const result = await claimBonuses(
    userId, user?.sleeperUserId ?? null, season, scoredWeek, creditWeek,
  );

  return {
    kinds: result.kinds,
    awarded: result.awarded,
    week: result.week,
    threshold: HIGH_SCORE_THRESHOLD,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();
  // Both from one look at the NFL state. `current` is the week everything else
  // on this page is about — the ration belongs to the week being played, so
  // packs appear on Tuesday rather than trailing a week behind — and
  // `completed` is only what the bonus check scores.
  const weeks = await resolveWeeks(req.nextUrl.searchParams.get('week'));
  const week = weeks.current;

  const now = new Date();

  try {
    // Sequential rather than in the Promise.all below: claiming a bonus
    // increments the same grant row readAllowance is about to read, and a
    // member who just won should see the pack on this response, not the next.
    const bonus = await claimBonusesFor(guard.userId, season, weeks.completed, week);

    // Also sequential, and for the same reason: this deletes roster rows that
    // readDeck is about to read, and a lineup still showing last week's
    // starters would look full and score nothing.
    await clearRetiredSlots(guard.userId, season, now);

    const [allowance, deck, weekly, seasons] = await Promise.all([
      readAllowance(guard.userId, season, week),
      readDeck(guard.userId, season, now),
      readWeeklyState(guard.userId, season, now),
      availableSeasons(),
    ]);

    const body: CollectionResponse = {
      allowance,
      stats: deck.stats,
      cards: deck.cards,
      roster: toRosterDtos(deck.roster, deck.cards),
      // Included so the page does not need a second call to /leaderboard for
      // standings this request has already computed.
      standings: deck.standings,
      bonus,
      weekly,
      seasons,
    };
    return ok(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read collection';
    return err(message, 500);
  }
}
