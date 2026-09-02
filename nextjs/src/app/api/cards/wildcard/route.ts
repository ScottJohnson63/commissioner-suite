// src/app/api/cards/wildcard/route.ts
//
// POST — throw one wildcard.
//
// A wildcard is a card now, not a weekly entitlement: it falls out of Silver,
// Gold and Hall of Fame packs, a member can be holding several, and each is
// thrown separately. So this takes the id of the one being thrown rather than
// assuming there is exactly one.
//
// The roll happens here rather than in the browser for the same reason the pack
// odds do: a die thrown on the client is a die you can throw until you like the
// answer.
//
// Throwing twice is prevented in the database, not by checking first — see
// claimWildcard. A second request is reported as `rolled: false` alongside the
// number that actually stuck, so a double-click shows the real roll rather than
// an error. A wildcard belonging to somebody else is a 404 rather than a 403:
// confirming the id exists would be the only thing a 403 added.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { resolveWeek } from '@/lib/sleeper/week';
import { claimWildcard, gameSeason } from '@/lib/cards/allowance';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  let body: { id?: unknown } | null = null;
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return err('An { "id" } naming the wildcard to throw is required', 400);
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return err('An { "id" } naming the wildcard to throw is required', 400);

  const season = gameSeason();
  const week = await resolveWeek(req.nextUrl.searchParams.get('week'), 'current');

  try {
    const result = await claimWildcard(guard.userId, id, season, week);
    if (!result) return err('No such wildcard', 404);

    return ok({ id, ...result, week, gameSeason: season });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to roll';
    return err(message, 500);
  }
}
