'use client';

// Shows every external data feed: what it pulls, when it last ran, and when it
// runs next. Commissioners also get a per-feed "Sync now" button.
//
// The pages at /league/league-sync and /league/stats-sync own the heading and
// the explanatory copy, so this component renders only the feed list.

import { useState, useEffect, useCallback } from 'react';
import { PANEL_BG, INNER_BG, PanelActionBtn, PanelSkeleton } from '@/components/dashboard/shared';

interface SyncRun {
  status: string;
  trigger: string;
  rowCount: number;
  startedAt: string;
  finishedAt: string | null;
  detail: unknown;
}

interface Feed {
  source: string;
  label: string;
  description: string;
  provider: string;
  cadence: string;
  seasonal: boolean;
  willSkip: boolean;
  scope: 'league' | 'global';
  nextRunAt: string | null;
  prevRunAt: string | null;
  resumesAt: string | null;
  overdue: boolean;
  lastRun: SyncRun | null;
  recentRuns: SyncRun[];
}

interface StatusResponse {
  feeds: Feed[];
  isCommissioner: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: '#80ff49',
  RUNNING: '#f5c542',
  SKIPPED: '#888',
  FAILED: '#ff6b6b',
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  // The annual jobs land in a later year; without it "Aug 1" on August 23rd
  // reads as a date that has already passed.
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year, hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Turns a run's stored `detail` blob into something readable.
 *
 * Each job notes different fields — the nflverse jobs record season and week,
 * the Sleeper jobs a league count, a skip records its reason, a failure its
 * error. Rather than dump raw JSON at the commissioner, pull out the shapes the
 * jobs in python/scripts and src/lib actually write, and fall back to listing
 * whatever else is there so a new field never goes invisible.
 */
function describeRun(run: SyncRun): string[] {
  const d = (run.detail ?? {}) as Record<string, unknown>;
  if (typeof run.detail === 'string') return [run.detail];

  const parts: string[] = [];
  const seen = new Set<string>();
  const take = (key: string) => { seen.add(key); return d[key]; };

  if (typeof d.reason === 'string') parts.push(String(take('reason')));
  if (typeof d.error === 'string') parts.push(String(take('error')));
  // The traceback is for the Actions log, not this panel.
  seen.add('traceback');

  const season = take('season');
  const week = take('week');
  if (season != null && week != null) parts.push(`Season ${String(season)}, week ${String(week)}`);
  else if (season != null) parts.push(`Season ${String(season)}`);
  else if (week != null) parts.push(`Week ${String(week)}`);

  const seasons = take('seasons');
  if (Array.isArray(seasons)) parts.push(`Seasons ${seasons.join(', ')}`);

  const leagues = take('leagues');
  if (typeof leagues === 'number') {
    parts.push(`${leagues} league${leagues === 1 ? '' : 's'}`);
  } else if (Array.isArray(leagues)) {
    // The in-process league sync records one entry per league it touched.
    const teams = leagues.reduce<number>(
      (sum, l) => sum + (typeof (l as { teamCount?: number })?.teamCount === 'number'
        ? (l as { teamCount: number }).teamCount : 0),
      0,
    );
    parts.push(
      `${leagues.length} league${leagues.length === 1 ? '' : 's'}` +
        (teams > 0 ? `, ${teams} teams` : ''),
    );
  }

  const failures = take('failures');
  if (Array.isArray(failures) && failures.length > 0) {
    parts.push(`Failed: ${failures.join(', ')}`);
  }

  // Anything a job started recording that this function does not know about.
  for (const [key, value] of Object.entries(d)) {
    if (seen.has(key)) continue;
    if (value == null || typeof value === 'object') continue;
    parts.push(`${key}: ${String(value)}`);
  }

  return parts;
}

/**
 * One-glance health for a feed.
 *
 * The question this answers is "did the cron run?", which the schedule alone
 * cannot tell you — a job that never started leaves no row, so an absent run
 * and a healthy one look identical without this.
 */
function HealthPill({ feed }: { feed: Feed }) {
  const [label, color, bg] = feed.overdue
    ? ['Overdue', '#f5c542', 'rgba(245,197,66,0.12)']
    : feed.lastRun?.status === 'FAILED'
      ? ['Failed', '#ff6b6b', 'rgba(255,107,107,0.12)']
      : feed.lastRun?.status === 'RUNNING'
        ? ['Running', '#f5c542', 'rgba(245,197,66,0.12)']
        : feed.lastRun?.status === 'SKIPPED'
          ? ['Skipped', '#888', 'rgba(255,255,255,0.05)']
          : feed.lastRun
            ? ['Up to date', '#80ff49', 'rgba(128,255,73,0.1)']
            : ['Never run', '#666', 'rgba(255,255,255,0.04)'];

  return (
    <span
      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function DataSyncPanel({
  isCommissioner,
  scope,
  leagueId = null,
  leagueName = null,
  onSynced,
}: {
  isCommissioner: boolean;
  /**
   * Which half of the feeds to render. The two live on separate pages: the
   * nflverse feeds are NFL-wide and need no league, the Sleeper feeds act on
   * one league and are meaningless without one.
   */
  scope: 'league' | 'global';
  /** Sleeper id of the chosen league. Only read when scope is 'league'. */
  leagueId?: string | null;
  leagueName?: string | null;
  /**
   * Called after a run that finished here rather than on Actions, so the caller
   * can re-read whatever it rewrote. A Sleeper league sync stores the league's
   * current name, and anything rendered from an earlier read — the cards above
   * this panel, the "Syncing …" line below — keeps the old one until it does.
   */
  onSynced?: () => void;
}) {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Scoped so "last run" answers for the league on screen, not for
      // whichever league happened to sync most recently.
      const res = await fetch(
        `/api/sync/status${leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : ''}`,
      );
      if (!res.ok) throw new Error('Failed to load sync status');
      const data = (await res.json()) as StatusResponse;
      setFeeds(data.feeds.filter((f) => f.scope === scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }, [leagueId, scope]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function runNow(source: string) {
    setRunning(source);
    setNotice(null);
    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, leagueId }),
      });
      const body = (await res.json()) as { error?: string; dispatched?: boolean; synced?: number };
      if (!res.ok) throw new Error(body.error ?? 'Sync failed');
      setNotice(
        body.dispatched
          ? 'Queued on GitHub Actions — results appear here once the job finishes.'
          : `Synced ${body.synced ?? 0} league(s).`,
      );
      await load();
      // A dispatched job has not touched the database yet — its own run row is
      // what will report it later — so only an in-process sync has new data to
      // hand back.
      if (!body.dispatched) onSynced?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="rounded-lg p-4" style={PANEL_BG}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-[11px]" style={{ color: '#888' }}>
          {scope === 'global'
            ? 'NFL-wide data — the same for every league'
            : leagueId
              ? <>Syncing <span style={{ color: '#80ff49' }}>{leagueName ?? leagueId}</span></>
              : 'No league selected'}
        </p>
        <p className="text-[11px]" style={{ color: '#555' }}>
          Times shown in your local timezone
        </p>
      </div>

      {notice && (
        <p className="text-xs mb-3 rounded px-3 py-2" style={{ ...INNER_BG, color: '#e8e6df' }}>
          {notice}
        </p>
      )}

      {error && <p className="text-xs" style={{ color: '#ff6b6b' }}>{error}</p>}
      {!feeds && !error && <PanelSkeleton rows={scope === 'global' ? 2 : 3} height={48} />}

      <div className="flex flex-col gap-2">
        {feeds?.map((feed) => (
          <div key={feed.source} className="rounded p-3" style={INNER_BG}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{feed.label}</span>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                    {feed.provider}
                  </span>
                  <HealthPill feed={feed} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: '#888' }}>{feed.description}</p>
              </div>

              {isCommissioner && (
                <PanelActionBtn
                  onClick={() => void runNow(feed.source)}
                  // A league feed with nothing selected has no target, so the
                  // button is disabled rather than failing on the server.
                  disabled={running !== null || (feed.scope === 'league' && !leagueId)}
                  loading={running === feed.source}
                  label="Sync now"
                  loadingLabel="Starting…"
                />
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>Schedule</p>
                <p style={{ color: '#e8e6df' }}>{feed.cadence}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                  {feed.willSkip ? 'Resumes' : 'Next run'}
                </p>
                {/* In the offseason the literal next firing only writes a
                    SKIPPED row, so the useful answer is when work restarts. */}
                <p style={{ color: '#e8e6df' }}>
                  {formatWhen(feed.willSkip ? feed.resumesAt : feed.nextRunAt)}
                </p>
                {feed.willSkip && (
                  <p className="text-[11px]" style={{ color: '#888' }}>
                    offseason until then
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>Last run</p>
                {feed.lastRun ? (
                  <p style={{ color: STATUS_COLOR[feed.lastRun.status] ?? '#e8e6df' }}>
                    {feed.lastRun.status.toLowerCase()} · {relative(feed.lastRun.startedAt)}
                    {feed.lastRun.rowCount > 0 && ` · ${feed.lastRun.rowCount} rows`}
                  </p>
                ) : (
                  <p style={{ color: '#555' }}>never</p>
                )}
              </div>
            </div>

            {/* What the last run actually changed. */}
            {feed.lastRun && describeRun(feed.lastRun).length > 0 && (
              <p className="text-[11px] mt-2" style={{ color: '#888' }}>
                {describeRun(feed.lastRun).join(' · ')}
              </p>
            )}

            {feed.overdue && (
              <p className="text-[11px] mt-2" style={{ color: '#f5c542' }}>
                Expected a run at {formatWhen(feed.prevRunAt)} — nothing was recorded.
                Check the workflow in the GitHub Actions tab.
              </p>
            )}

            {feed.recentRuns.length > 1 && (
              <details className="mt-2">
                <summary
                  className="text-[11px] cursor-pointer select-none"
                  style={{ color: '#666' }}
                >
                  Run log ({feed.recentRuns.length})
                </summary>
                <div className="flex flex-col gap-1.5 mt-2">
                  {feed.recentRuns.map((run) => (
                    <div key={run.startedAt} className="text-[11px] flex flex-wrap gap-x-2">
                      <span
                        className="tabular-nums"
                        style={{ color: '#555', minWidth: '9.5rem' }}
                      >
                        {formatWhen(run.startedAt)}
                      </span>
                      <span style={{ color: STATUS_COLOR[run.status] ?? '#e8e6df' }}>
                        {run.status.toLowerCase()}
                      </span>
                      <span style={{ color: '#555' }}>{run.trigger}</span>
                      {run.rowCount > 0 && (
                        <span style={{ color: '#888' }}>{run.rowCount} rows</span>
                      )}
                      <span style={{ color: '#666' }}>{describeRun(run).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
