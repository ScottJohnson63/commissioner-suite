// src/lib/syncRun.ts
//
// TypeScript half of the sync bookkeeping that python/scripts/common/syncrun.py
// does for the scheduled jobs. Both write the same SyncRun rows, so the Data
// Sync tab shows in-process syncs and GitHub Actions syncs side by side.

import { prisma } from '@/lib/prisma';
import type { SyncSource } from '@/lib/syncSchedule';

export interface RunOutcome {
  rowCount?: number;
  detail?: Record<string, unknown>;
}

/**
 * Runs `work`, recording the attempt as a SyncRun row either way.
 *
 * A RUNNING row is written up front so a request that dies mid-flight still
 * leaves a trace. Bookkeeping failures are swallowed — a broken audit trail
 * must never take down the sync it is describing.
 */
export async function recordSyncRun<T extends RunOutcome>(
  source: SyncSource,
  trigger: 'manual' | 'schedule',
  work: () => Promise<T>,
  /**
   * Sleeper league this run covers. Omit for a global feed or for a run that
   * sweeps every league — null then reads correctly as "not league-specific".
   */
  leagueId?: string | null,
): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;

  try {
    const row = await prisma.syncRun.create({
      data: { source, status: 'RUNNING', trigger, startedAt, leagueId: leagueId ?? null },
      select: { id: true },
    });
    runId = row.id;
  } catch (error) {
    console.error('Could not record sync start:', error);
  }

  const finish = async (
    status: 'SUCCESS' | 'FAILED',
    rowCount: number,
    detail: Record<string, unknown>,
  ) => {
    if (!runId) return;
    try {
      await prisma.syncRun.update({
        where: { id: runId },
        data: { status, rowCount, detail: JSON.stringify(detail), finishedAt: new Date() },
      });
    } catch (error) {
      console.error('Could not record sync completion:', error);
    }
  };

  try {
    const result = await work();
    await finish('SUCCESS', result.rowCount ?? 0, result.detail ?? {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish('FAILED', 0, { error: message });
    throw error;
  }
}
