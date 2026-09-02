// src/app/api/cards/results/route.ts
//
// GET — what everybody played in one week, once it has been published.
//
// `?week=` picks a week and defaults to the most recent published one. The
// reveal is enforced in readWeekResults rather than here: a route that decided
// it would be one guard away from leaking Sunday's lineups to anyone who typed
// a week number into the query string, and the rule belongs next to the clock
// that defines it.
//
// 404 for a week that has not been published rather than an empty body, so a
// member who bookmarks week 9 in week 8 is told it is not out yet instead of
// being shown a league that apparently submitted nothing.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { gameSeason } from '@/lib/cards/allowance';
import { defaultResultsWeek, readWeekResults } from '@/lib/cards/weekly';
import { revealedWeeks } from '@/lib/cards/weeklyGame';
import type { WeekResultsDto } from '@/types/cards';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();
  const now = new Date();

  const requested = req.nextUrl.searchParams.get('week');
  const week = requested ? Number(requested) : defaultResultsWeek(season, now);

  // Nothing has been published yet — the season's first Tuesday has not come
  // round. An empty payload rather than a 404: the page has a week picker to
  // draw either way, and "no results yet" is a state, not a missing resource.
  if (week === null) {
    const body: WeekResultsDto = {
      gameSeason: season, week: 0, revealedAt: '',
      entries: [], cards: [], weeks: revealedWeeks(season, now),
    };
    return ok(body);
  }

  if (!Number.isInteger(week) || week < 1) {
    return err('"week" must be a week number, e.g. ?week=3', 400);
  }

  try {
    const results = await readWeekResults(season, week, guard.userId, now);
    if (!results) return err(`Week ${week}'s results are not out yet`, 404);
    return ok(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read the results';
    return err(message, 500);
  }
}
