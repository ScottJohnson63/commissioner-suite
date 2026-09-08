'use client';

import { useState, useCallback, useEffect } from 'react';
import { ScheduleGrid } from '@/components/ScheduleGrid';
import { StatCards } from '@/components/StatCards';
import { TeamLog } from '@/components/TeamLog';
import type { AssocSchedule, AssocTeam } from '@/types/schedule';

export function SchedulesTab({
  activeLeagueId,
  sleeperLeagueId,
  refreshKey,
  isCommissioner,
}: {
  /** Internal DB id for the league — null until the league has been synced. */
  activeLeagueId: string | null;
  /** Sleeper league id — available as soon as a league is selected in the dashboard. */
  sleeperLeagueId: string | null;
  refreshKey: number;
  isCommissioner: boolean;
}) {
  // Prefer the DB id (stable, already resolved); fall back to the Sleeper id so
  // the Generate button works even before the first sync.
  const effectiveId = activeLeagueId ?? sleeperLeagueId;

  const [schedule, setSchedule]               = useState<AssocSchedule | null>(null);
  const [selectedTeamId, setSelectedTeamId]   = useState<string | null>(null);
  const [loading, setLoading]                 = useState(false);
  const [generating, setGenerating]           = useState(false);
  const [clearing, setClearing]               = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchSchedule = useCallback(async (leagueId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/schedule`);
      if (res.status === 404) { setSchedule(null); return; }
      if (!res.ok) throw new Error('Failed to load schedule');
      setSchedule(await res.json() as AssocSchedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (effectiveId) void fetchSchedule(effectiveId);
    else setSchedule(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeagueId, sleeperLeagueId, refreshKey, fetchSchedule]);

  async function handleGenerate(): Promise<void> {
    if (!effectiveId) return;
    setGenerating(true); setError(null);
    try {
      const res = await fetch(`/api/leagues/${effectiveId}/schedule`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Schedule generation failed');
      }
      await fetchSchedule(effectiveId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally { setGenerating(false); }
  }

  async function handleClear(): Promise<void> {
    if (!effectiveId) return;
    setClearing(true); setError(null);
    try {
      const res = await fetch(`/api/leagues/${effectiveId}/schedule`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Clear failed');
      }
      setSchedule(null); setShowClearConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally { setClearing(false); }
  }

  async function handleExport(): Promise<void> {
    if (!effectiveId || !schedule) return;
    const res = await fetch(`/api/leagues/${effectiveId}/schedule/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `schedule-${schedule.season}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSwap(matchupId: string, homeTeamId: string, awayTeamId: string): Promise<void> {
    const res = await fetch(`/api/matchups/${matchupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeTeamId: awayTeamId, awayTeamId: homeTeamId }),
    });
    if (!res.ok) throw new Error('Swap failed');
    if (effectiveId) await fetchSchedule(effectiveId);
  }

  const byWeek = schedule
    ? Array.from({ length: 13 }, (_, i) => schedule.matchups.filter((m) => m.week === i + 1))
    : [];

  const allTeams: AssocTeam[] = schedule
    ? Array.from(
        new Map(
          schedule.matchups.flatMap((m) => [
            [m.homeTeam.id, m.homeTeam],
            [m.awayTeam.id, m.awayTeam],
          ]),
        ).values(),
      )
    : [];

  const divisionMatchups = schedule?.matchups.filter((m) => m.type === 'division') ?? [];
  const crossMatchups    = schedule?.matchups.filter((m) => m.type === 'cross-division') ?? [];

  const selectedTeamMatchups = selectedTeamId
    ? schedule?.matchups.filter(
        (m) => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId,
      ) ?? []
    : [];

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {isCommissioner && effectiveId && (
          <button
            onClick={handleGenerate}
            disabled={loading || generating}
            className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40 touch-manipulation"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
          >
            {generating ? 'Generating…' : schedule ? '↻ Regenerate' : '+ Generate Schedule'}
          </button>
        )}
        {schedule && (
          <>
            <button
              onClick={handleExport}
              className="px-4 py-2 rounded text-sm font-medium border border-[#2a2a2c] transition-colors
                         hover:border-[#444] hover:text-[#e8e6df] touch-manipulation"
              style={{ color: '#888' }}
            >
              ↓ Export CSV
            </button>
            {isCommissioner && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-4 py-2 rounded text-sm font-medium border transition-colors touch-manipulation"
                style={{ borderColor: 'rgba(255,73,73,0.3)', color: '#ff4949', background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,73,73,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                ✕ Clear Schedule
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-xs border"
          style={{ background: 'rgba(255,73,73,0.08)', color: '#ff4949', borderColor: 'rgba(255,73,73,0.2)' }}>
          {error}
        </div>
      )}

      {loading && !schedule && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded border border-[#2a2a2c] animate-pulse"
              style={{ background: '#141415' }} />
          ))}
        </div>
      )}

      {!loading && !schedule && effectiveId && (
        <p className="text-xs text-center py-20" style={{ color: '#555' }}>
          No schedule yet. Generate one above.
        </p>
      )}

      {!effectiveId && (
        <p className="text-xs text-center py-20" style={{ color: '#555' }}>
          Select a league to get started.
        </p>
      )}

      {schedule && (
        <>
          <StatCards
            total={schedule.matchups.length}
            division={divisionMatchups.length}
            cross={crossMatchups.length}
            generatedAt={schedule.generatedAt}
          />
          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex-1 min-w-0">
              <ScheduleGrid weeks={byWeek} onSwap={isCommissioner ? handleSwap : undefined} />
            </div>
            <div className="w-full sm:w-64 sm:shrink-0">
              <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#80ff49' }}>
                Team schedule
              </p>
              <div className="grid grid-cols-2 gap-1 mb-4 sm:flex sm:flex-col">
                {allTeams
                  .sort((a, b) => a.divisionId - b.divisionId || a.name.localeCompare(b.name))
                  .map((team) => (
                    <button
                      key={team.id}
                      onClick={() => setSelectedTeamId((prev) => (prev === team.id ? null : team.id))}
                      className={`text-left px-3 py-1.5 rounded text-xs transition-colors touch-manipulation ${
                        selectedTeamId === team.id
                          ? 'bg-[#e8e6df] text-[#0e0e0f]'
                          : team.divisionId === 0
                          ? 'hover:text-[#c849ff]'
                          : 'hover:text-[#ff6d49]'
                      }`}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-2"
                        style={{ background: team.divisionId === 0 ? '#c849ff' : '#ff6d49' }}
                      />
                      {team.name}
                    </button>
                  ))}
              </div>
              {selectedTeamId && (
                <TeamLog matchups={selectedTeamMatchups} teamId={selectedTeamId} teams={allTeams} />
              )}
            </div>
          </div>
        </>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#141415] border border-[#2a2a2c] rounded-lg p-6 w-full max-w-sm">
            <h2 className="text-sm font-medium mb-1">Clear schedule?</h2>
            <p className="text-xs mb-6" style={{ color: '#555' }}>
              This will permanently delete all matchups for this league. You can regenerate afterwards.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)} disabled={clearing}
                className="px-3 py-1.5 text-xs text-[#666] hover:text-[#e8e6df] transition-colors
                           disabled:opacity-40 touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleClear} disabled={clearing}
                className="px-3 py-1.5 text-xs rounded font-medium transition-colors
                           disabled:opacity-40 touch-manipulation"
                style={{ background: '#ff4949', color: '#fff' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#ff6666')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ff4949')}
              >
                {clearing ? 'Clearing…' : 'Yes, clear it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
