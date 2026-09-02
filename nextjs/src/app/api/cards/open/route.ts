// src/app/api/cards/open/route.ts
//
// POST — spend one weekly pack and return the five cards it dealt.
//
// The roll happens here rather than on the client for the obvious reason: the
// client is where someone would reroll until a Hall of Fame card fell out. The
// response is the record of what was already written.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { resolveWeek } from '@/lib/sleeper/week';
import { gameSeason } from '@/lib/cards/allowance';
import { openOnePack } from '@/lib/cards/service';
import type { OpenPackResponse } from '@/types/cards';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const season = gameSeason();
  const week = await resolveWeek(req.nextUrl.searchParams.get('week'), 'current');

  try {
    const outcome = await openOnePack(guard.userId, season, week);

    if (!outcome.ok) {
      // 409 rather than 403: nothing about the member is wrong, the request
      // just conflicts with a balance that is already spent.
      return outcome.reason === 'NO_PACKS'
        ? err('No packs left this week', 409)
        : err('No cards have been built yet — ask a commissioner to build the pool', 409);
    }

    const body: OpenPackResponse = outcome.result;
    return ok(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open pack';
    return err(message, 500);
  }
}
