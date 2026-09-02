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
// Signed-in members only. The collection is per-user by definition, so there is
// no public view to fall back to.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { prisma } from '@/lib/prisma';
import { HIGH_SCORE_THRESHOLD, claimBonuses } from '@/lib/cards/bonus';
import { resolveWeek } from '@/lib/sleeper/week';
import { gameSeason } from '@/lib/cards/allowance';
import { readAllowance, readDeck } from '@/lib/cards/service';
import { availableSeasons } from '@/lib/cards/pool';
import { toRosterDto } from '@/lib/cards/rosterDto';
import type { CollectionResponse } from '@/types/cards';

/**
 * Checks Sleeper for bonus packs, resolving the member's Sleeper account first.
 *
 * A member with no linked Sleeper id simply earns nothing — the card game does
 * not require one, and a missing link is a normal state rather than an error.
 */
async function claimBonusesFor(userId: string, season: number, week: number) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { sleeperUserId: true },
  });

  const result = await claimBonuses(userId, user?.sleeperUserId ?? null, season, week);

  return {
    kinds: result.kinds,
    awarded: result.awarded,
    threshold: HIGH_SCORE_THRESHOLD,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();
  // 'current' rather than 'completed': the ration belongs to the week being
  // played, so packs appear on Tuesday rather than trailing a week behind.
  const week = await resolveWeek(req.nextUrl.searchParams.get('week'), 'current');

  try {
    // Sequential rather than in the Promise.all below: claiming a bonus
    // increments the same grant row readAllowance is about to read, and a
    // member who just won should see the pack on this response, not the next.
    const bonus = await claimBonusesFor(guard.userId, season, week);

    const [allowance, deck, seasons] = await Promise.all([
      readAllowance(guard.userId, season, week),
      readDeck(guard.userId, season),
      availableSeasons(),
    ]);

    const body: CollectionResponse = {
      allowance,
      stats: deck.stats,
      cards: deck.cards,
      roster: deck.roster.map(toRosterDto),
      // Included so the page does not need a second call to /leaderboard for
      // standings this request has already computed.
      standings: deck.standings,
      bonus,
      seasons,
    };
    return ok(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read collection';
    return err(message, 500);
  }
}
