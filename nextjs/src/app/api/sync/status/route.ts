// src/app/api/sync/status/route.ts
//
// GET /api/sync/status
//
// One row per external data feed: what it pulls, how often, when it last ran,
// and when it runs next. Backs the dashboard's Data Sync tab.
//
// "Last run" comes from the SyncRun table, which every sync job writes to —
// including the Python jobs on GitHub Actions. "Next run" is computed from the
// cron strings in src/lib/syncSchedule.ts, so no GitHub API call is needed.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { ok, err } from '@/lib/api';
import {
  SYNC_JOBS, nextRun, previousRun, nextActiveRun, isInSeason, OVERDUE_GRACE_MS,
} from '@/lib/syncSchedule';

export interface SyncRunSummary {
  status: string;
  trigger: string;
  rowCount: number;
  startedAt: string;
  finishedAt: string | null;
  detail: unknown;
}

export interface SyncFeedStatus {
  source: string;
  label: string;
  description: string;
  provider: string;
  cadence: string;
  seasonal: boolean;
  /** True when a seasonal job's next cron firing will exit early. */
  willSkip: boolean;
  canRunManually: boolean;
  /** 'league' feeds honour the selected league; 'global' ones are NFL-wide. */
  scope: 'league' | 'global';
  nextRunAt: string | null;
  /** When the cron last should have fired. Null for on-demand feeds. */
  prevRunAt: string | null;
  /**
   * The next firing that will do work rather than skip. Differs from nextRunAt
   * only for a seasonal feed sitting out the offseason, where it is the date
   * the feed wakes back up.
   */
  resumesAt: string | null;
  /**
   * The schedule came round and nothing was recorded. This is the signal the
   * cron itself cannot give you — a job that never started writes no row, so
   * silence is indistinguishable from success unless it is checked for.
   */
  overdue: boolean;
  lastRun: SyncRunSummary | null;
  /** Newest first, for the run log. Includes lastRun as its first entry. */
  recentRuns: SyncRunSummary[];
}

function parseDetail(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return err('Unauthorized', 401);

  // The league picked in the header. Its runs are the ones a league-scoped feed
  // reports on; a run with leagueId NULL swept every league, so it counts too.
  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim() || null;

  try {
    // One query for every feed's newest row, rather than N queries.
    const recent = await prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: SYNC_JOBS.length * 40,
    });

    const now = new Date();
    const feeds: SyncFeedStatus[] = SYNC_JOBS.map((job) => {
      const next = job.cron ? nextRun(job.cron, now) : null;
      const prev = job.cron ? previousRun(job.cron, now) : null;
      const resumes = job.cron ? nextActiveRun(job.cron, job.seasonal, now) : null;

      // A global feed has no league dimension. For a league feed, keep the runs
      // that either targeted this league or swept them all.
      const mine = recent.filter(
        (run) =>
          run.source === job.source &&
          (job.scope === 'global' ||
            run.leagueId === null ||
            (leagueId !== null && run.leagueId === leagueId)),
      );

      const summarise = (run: (typeof recent)[number]): SyncRunSummary => ({
        status: run.status,
        trigger: run.trigger,
        rowCount: run.rowCount,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        detail: parseDetail(run.detail),
      });

      const last = mine[0];

      // Overdue only means "the schedule fired and nothing was recorded". A run
      // that failed or skipped is not overdue — it ran and said so, and its own
      // status carries that news.
      const overdue =
        prev !== null &&
        now.getTime() - prev.getTime() > OVERDUE_GRACE_MS &&
        (!last || last.startedAt.getTime() < prev.getTime());

      return {
        source: job.source,
        label: job.label,
        description: job.description,
        provider: job.provider,
        cadence: job.cadence,
        seasonal: job.seasonal,
        willSkip: job.seasonal && next !== null && !isInSeason(next),
        canRunManually: true,
        scope: job.scope,
        nextRunAt: next?.toISOString() ?? null,
        prevRunAt: prev?.toISOString() ?? null,
        resumesAt: resumes?.toISOString() ?? null,
        overdue,
        lastRun: last ? summarise(last) : null,
        recentRuns: mine.slice(0, 5).map(summarise),
      };
    });

    return ok({
      feeds,
      isCommissioner: session.user?.role === 'COMMISSIONER',
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return err('Failed to load sync status');
  }
}
