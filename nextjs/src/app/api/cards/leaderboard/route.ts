// src/app/api/cards/leaderboard/route.ts
//
// GET — the season standings.
//
// Cards are owned exclusively, so the game is a race rather than a collection:
// this is the screen that says who is winning it. Every account appears, including
// members who have not opened a pack, on a score of zero.

import { NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { gameSeason } from '@/lib/cards/allowance';
import { readLeaderboard } from '@/lib/cards/service';
import type { LeaderboardResponse } from '@/types/cards';

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();

  try {
    const entries = await readLeaderboard(season, guard.userId);
    const body: LeaderboardResponse = { gameSeason: season, entries };
    return ok(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read standings';
    return err(message, 500);
  }
}
