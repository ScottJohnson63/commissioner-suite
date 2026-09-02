// src/app/api/cards/lineup/route.ts
//
// POST — submit this week's lineup.
//
// The weekly game in one request: whatever is in the member's slots right now
// is frozen, scored, and stamped with the deadline it beat. Nothing is sent in
// the body — the lineup is already on the server, and accepting a client's copy
// of it would mean re-validating ownership, eligibility and retirement for nine
// cards on a request whose whole job is to say "that one, now".
//
// Re-submitting before the deadline overwrites. The deadline is the only thing
// that closes a week, which is why the refusal for a late submission is a 409
// rather than a 400: nothing about the request was malformed, it just arrived
// after Monday 11:59pm central.

import { NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { gameSeason } from '@/lib/cards/allowance';
import { submitLineup } from '@/lib/cards/weekly';
import type { SubmitLineupResponse } from '@/types/cards';

export async function POST(): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();

  try {
    const result = await submitLineup(guard.userId, season);

    if (!result.ok) {
      switch (result.reason) {
        case 'LOCKED':
          return err('Lineups locked at 11:59pm Monday — results are on the way', 409);
        case 'SEASON_OVER':
          return err('The season is over — there are no more weeks to play', 409);
        case 'EMPTY':
          return err('Put at least one card in your lineup before submitting', 400);
        case 'RETIRED':
          // The database refused the write, which means a card in the lineup
          // has already played. Re-reading the deck is what clears it.
          return err('One of those cards has already played this season', 409);
      }
    }

    const body: SubmitLineupResponse = {
      week:     result.result.week,
      points:   result.result.points,
      filled:   result.result.filled,
      lockAt:   result.result.lockAt.toISOString(),
      revealAt: result.result.revealAt.toISOString(),
    };
    return ok(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit your lineup';
    return err(message, 500);
  }
}
