// src/app/api/sync/run/route.ts
//
// POST /api/sync/run   body: { source: SyncSource }
//
// Lets a commissioner pull fresh data without waiting for the cron. Two paths:
//
//   SLEEPER_LEAGUES — runs here and now, since it is just a few Sleeper calls
//                     plus upserts.
//   everything else — lives in a Python job on GitHub Actions (nflverse needs
//                     polars), so this fires a workflow_dispatch and returns.
//                     Jobs flagged `forceOnManualRun` get FORCE=true so their
//                     season guard does not turn a deliberate run into a no-op.
//
// Workflow dispatch needs GITHUB_SYNC_TOKEN (a PAT or fine-grained token with
// `actions: write`) and GITHUB_REPOSITORY ("owner/repo"). Without them the
// endpoint says so plainly rather than silently reporting success.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { ok, err } from '@/lib/api';
import { jobFor } from '@/lib/syncSchedule';
import { syncLeague, type LeagueSyncResult } from '@/lib/sleeper/sync';
import { recordSyncRun } from '@/lib/syncRun';

const GITHUB_API = 'https://api.github.com';

async function dispatchWorkflow(
  workflow: string,
  force: boolean,
  leagueId: string | null,
): Promise<NextResponse> {
  const token = process.env.GITHUB_SYNC_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    return err(
      'Manual runs of this job need GITHUB_SYNC_TOKEN and GITHUB_REPOSITORY to be set. ' +
        'Until then, run the workflow from the GitHub Actions tab.',
      501,
    );
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      // GitHub rejects inputs a workflow has not declared, so only send what
      // the job defines: `force` for the ones with a season guard, `league_id`
      // for the league-scoped Sleeper jobs.
      body: JSON.stringify({
        ref: 'main',
        ...(force || leagueId
          ? {
              inputs: {
                ...(force ? { force: 'true' } : {}),
                ...(leagueId ? { league_id: leagueId } : {}),
              },
            }
          : {}),
      }),
    },
  );

  if (!res.ok) {
    return err(`GitHub refused the dispatch (${res.status}): ${await res.text()}`, 502);
  }

  // 204 No Content means queued. The job writes its own SyncRun row when it
  // starts, so there is nothing to record here.
  return ok({ dispatched: true, workflow });
}

/** Syncs one registered league, or every one of them when `leagueId` is null. */
async function syncLeagues(leagueId: string | null): Promise<NextResponse> {
  const leagues = await prisma.league.findMany({
    where: leagueId ? { sleeperLeagueId: leagueId } : undefined,
    select: { sleeperLeagueId: true },
  });
  if (leagues.length === 0) {
    return err(
      leagueId
        ? 'That league is not registered.'
        : 'No leagues are registered yet — add one first.',
      400,
    );
  }

  const results: LeagueSyncResult[] = [];
  try {
    await recordSyncRun(
      'SLEEPER_LEAGUES',
      'manual',
      async () => {
        for (const { sleeperLeagueId } of leagues) {
          results.push(await syncLeague(sleeperLeagueId));
        }
        return { rowCount: results.length, detail: { leagues: results } };
      },
      leagueId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Manual league sync failed:', error);
    return NextResponse.json({ error: message, results }, { status: 500 });
  }

  return ok({ synced: results.length, results });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (session?.user?.role !== 'COMMISSIONER') return err('Forbidden', 403);

  const { source, leagueId } = (await req.json()) as {
    source?: string;
    leagueId?: string | null;
  };
  const job = source ? jobFor(source) : undefined;
  if (!job) return err('Unknown sync source', 400);

  // A global feed pulls the same NFL-wide data whatever league you are looking
  // at, so a league id is dropped rather than silently narrowing nothing.
  const scopedLeagueId = job.scope === 'league' ? (leagueId?.trim() || null) : null;

  // Never dispatch a league id that is not in the allowlist: the League table
  // is what makes a league this app's business.
  if (scopedLeagueId) {
    const known = await prisma.league.findUnique({
      where: { sleeperLeagueId: scopedLeagueId },
      select: { id: true },
    });
    if (!known) return err('That league is not registered.', 400);
  }

  try {
    return job.workflow
      ? await dispatchWorkflow(job.workflow, job.forceOnManualRun, scopedLeagueId)
      : await syncLeagues(scopedLeagueId);
  } catch (error) {
    console.error('Sync run error:', error);
    return err(error instanceof Error ? error.message : 'Sync failed');
  }
}
