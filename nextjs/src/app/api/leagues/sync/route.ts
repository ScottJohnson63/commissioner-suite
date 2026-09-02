// src/app/api/leagues/sync/route.ts
//
// POST /api/leagues/sync
//
// Syncs one or more Sleeper leagues into the local database. Called from the
// Commissioner dashboard's "Sync League" button.
//
// Request body:
//   leagueIds — array of Sleeper league IDs to sync (at least one required)
//
// Commissioner-only: this writes League and Team rows that every other page
// reads from, so it is not something a regular member should be able to trigger.
//
// If any league fails, the handler returns a 500 with partial results and the
// error message. The caller can retry the failed league independently.

import { NextRequest, NextResponse } from 'next/server';
import { syncLeague, type LeagueSyncResult } from '@/lib/sleeper/sync';
import { recordSyncRun } from '@/lib/syncRun';
import { ok, err } from '@/lib/api';
import { requireCommissioner } from '@/lib/apiAuth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await requireCommissioner();
  if (denied) return denied;

  const body = await req.json() as { leagueIds?: string[] };

  if (!Array.isArray(body.leagueIds) || body.leagueIds.length === 0) {
    return err('leagueIds must be a non-empty array', 400);
  }

  const results: LeagueSyncResult[] = [];

  try {
    await recordSyncRun('SLEEPER_LEAGUES', 'manual', async () => {
      for (const leagueId of body.leagueIds!) {
        try {
          results.push(await syncLeague(leagueId));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed on league ${leagueId}: ${message}`);
        }
      }
      return { rowCount: results.length, detail: { leagues: results } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('League sync error:', error);
    // Include partial results in the error body — can't use err() here.
    return NextResponse.json({ error: message, results }, { status: 500 });
  }

  return ok({ synced: results.length, results });
}
