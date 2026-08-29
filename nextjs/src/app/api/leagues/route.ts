// src/app/api/leagues/route.ts
//
// GET  /api/leagues   — every league registered in the local database.
// POST /api/leagues   — register one by Sleeper league ID (commissioner only).
//
// The League table is the allowlist for the whole app: a Sleeper league only
// appears anywhere once a commissioner has added its ID here. Members then see
// the intersection of their own Sleeper leagues with this table, so nobody can
// pull an unrelated league into the app just by belonging to it.
//
// GET requires a session but no particular role — every signed-in user needs
// the list to know which league context their other calls are in.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { syncLeague } from '@/lib/sleeper/sync';
import { recordSyncRun } from '@/lib/syncRun';
import { ok, err } from '@/lib/api';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session) return err('Unauthorized', 401);

  try {
    const leagues = await prisma.league.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return ok(leagues);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch leagues';
    return err(message);
  }
}

/** Sleeper league IDs are numeric strings; anything else never reaches Sleeper. */
const SLEEPER_ID = /^\d{6,25}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (session?.user?.role !== 'COMMISSIONER') return err('Forbidden', 403);

  const body = (await req.json()) as { sleeperLeagueId?: string };
  const sleeperLeagueId = body.sleeperLeagueId?.trim();

  if (!sleeperLeagueId) return err('sleeperLeagueId is required', 400);
  if (!SLEEPER_ID.test(sleeperLeagueId)) {
    return err('That does not look like a Sleeper league ID — expected digits only.', 400);
  }

  const existing = await prisma.league.findUnique({ where: { sleeperLeagueId } });
  if (existing) return err('That league is already registered.', 409);

  try {
    // Registering pulls the league in immediately: an entry with no teams would
    // show up in the selector and then render an empty app.
    const result = await recordSyncRun(
      'SLEEPER_LEAGUES',
      'manual',
      async () => {
        const synced = await syncLeague(sleeperLeagueId);
        return { rowCount: 1, detail: { leagues: [synced] } };
      },
      sleeperLeagueId,
    );

    const league = await prisma.league.findUnique({ where: { sleeperLeagueId } });
    return ok({ league, synced: result.rowCount });
  } catch (error) {
    // Sleeper 404s and the 2-division rule both land here, and both are the
    // commissioner's to fix — pass the reason through rather than a generic 500.
    const message = error instanceof Error ? error.message : String(error);
    return err(`Could not add that league: ${message}`, 400);
  }
}
