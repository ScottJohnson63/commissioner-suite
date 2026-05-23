'use client';

// src/app/page.tsx

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ScheduleGrid } from '@/components/ScheduleGrid';
import { StatCards } from '@/components/StatCards';
import { TeamLog } from '@/components/TeamLog';
import { LeagueSwitcher } from '@/components/LeagueSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  divisionId: number;
  sleeperRosterId: string;
}

interface MatchupWithTeams {
  id: string;
  week: number;
  type: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: Team;
  awayTeam: Team;
}

interface Schedule {
  id: string;
  season: number;
  generatedAt: string;
  league: { id: string; sleeperLeagueId: string };
  matchups: MatchupWithTeams[];
}

interface League {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [syncInput, setSyncInput] = useState('');

  // ── Fetch all leagues on mount
  useEffect(() => {
    async function loadLeagues(): Promise<void> {
      try {
        const res = await fetch('/api/leagues');
        if (!res.ok) throw new Error('Failed to load leagues');
        const data = await res.json() as League[];
        setLeagues(data);
        if (data.length > 0) setActiveLeagueId(data[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load leagues');
      }
    }
    loadLeagues();
  }, []);

  // ── Fetch schedule whenever active league changes
  const fetchSchedule = useCallback(async (leagueId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/schedule`);
      if (res.status === 404) { setSchedule(null); return; }
      if (!res.ok) throw new Error('Failed to load schedule');
      const data = await res.json() as Schedule;
      setSchedule(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeLeagueId) fetchSchedule(activeLeagueId);
  }, [activeLeagueId, fetchSchedule]);

  async function handleSync(sleeperLeagueId: string): Promise<void> {
    if (!sleeperLeagueId.trim()) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/leagues/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds: [sleeperLeagueId.trim()] }),
      });
      if (!res.ok) throw new Error('Sync failed');
      setLastSynced(new Date());
      const leaguesRes = await fetch('/api/leagues');
      if (leaguesRes.ok) {
        const data = await leaguesRes.json() as League[];
        setLeagues(data);
        if (!activeLeagueId && data.length > 0) setActiveLeagueId(data[0].id);
      }
      if (activeLeagueId) await fetchSchedule(activeLeagueId);
      setShowSyncModal(false);
      setSyncInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!activeLeagueId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${activeLeagueId}/schedule`, { method: 'POST' });
      if (!res.ok) throw new Error('Schedule generation failed');
      await fetchSchedule(activeLeagueId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleClear(): Promise<void> {
    if (!activeLeagueId) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${activeLeagueId}/schedule`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Clear failed');
      }
      setSchedule(null);
      setShowClearConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setClearing(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!activeLeagueId || !schedule) return;
    const res = await fetch(`/api/leagues/${activeLeagueId}/schedule/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${schedule.season}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSwap(
    matchupId: string,
    homeTeamId: string,
    awayTeamId: string,
  ): Promise<void> {
    const res = await fetch(`/api/matchups/${matchupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeTeamId: awayTeamId, awayTeamId: homeTeamId }),
    });
    if (!res.ok) throw new Error('Swap failed');
    if (activeLeagueId) await fetchSchedule(activeLeagueId);
  }

  // ── Derived data
  const byWeek = schedule
    ? Array.from({ length: 13 }, (_, i) =>
        schedule.matchups.filter((m) => m.week === i + 1),
      )
    : [];

  const allTeams: Team[] = schedule
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
  const crossMatchups = schedule?.matchups.filter((m) => m.type === 'cross-division') ?? [];

  const selectedTeamMatchups = selectedTeamId
    ? schedule?.matchups.filter(
        (m) => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId,
      ) ?? []
    : [];

  const activeLeague = leagues.find((l) => l.id === activeLeagueId);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8" style={{ background: '#0e0e0f', color: '#e8e6df' }}>
      <div className="max-w-5xl mx-auto">

        {/* ── Top nav */}
        <div className="flex items-center justify-between mb-6">
          <LeagueSwitcher
            leagues={leagues}
            activeId={activeLeagueId}
            onChange={setActiveLeagueId}
          />
          <Link
            href="/log"
            className="text-xs transition-colors touch-manipulation hover:text-[#e8e6df]"
            style={{ color: '#555' }}
          >
            Activity Log →
          </Link>
        </div>

        {/* ── Error banner */}
        {error && (
          <div
            className="mb-4 px-3 py-2 rounded text-xs border"
            style={{
              background: 'rgba(255,73,73,0.08)',
              color: '#ff4949',
              borderColor: 'rgba(255,73,73,0.2)',
            }}
          >
            {error}
          </div>
        )}

        {/* ── Action bar */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setShowSyncModal(true)}
            className="px-4 py-2 rounded text-sm font-medium border border-[#2a2a2c] transition-colors
                       hover:border-[#444] hover:text-[#e8e6df] touch-manipulation"
            style={{ color: '#888' }}
          >
            {lastSynced ? '↻ Re-sync' : '+ Sync League'}
          </button>

          {!loading && activeLeagueId && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40 touch-manipulation"
              style={{ background: '#80ff49', color: '#0e0e0f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
            >
              {generating ? 'Generating…' : schedule ? '↻ Regenerate' : '+ Generate Schedule'}
            </button>
          )}

          {!loading && schedule && (
            <>
              <button
                onClick={handleExport}
                className="px-4 py-2 rounded text-sm font-medium border border-[#2a2a2c] transition-colors
                           hover:border-[#444] hover:text-[#e8e6df] touch-manipulation"
                style={{ color: '#888' }}
              >
                ↓ Export CSV
              </button>

              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-4 py-2 rounded text-sm font-medium border transition-colors touch-manipulation"
                style={{
                  borderColor: 'rgba(255,73,73,0.3)',
                  color: '#ff4949',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,73,73,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                ✕ Clear Schedule
              </button>
            </>
          )}
        </div>

        {/* ── Loading skeleton */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 rounded border border-[#2a2a2c] animate-pulse"
                style={{ background: '#141415' }}
              />
            ))}
          </div>
        )}

        {/* ── Empty state */}
        {!loading && !schedule && activeLeagueId && (
          <p className="text-xs text-center py-20" style={{ color: '#555' }}>
            No schedule yet. Generate one above.
          </p>
        )}

        {/* ── Schedule content */}
        {!loading && schedule && (
          <>
            <StatCards
              total={schedule.matchups.length}
              division={divisionMatchups.length}
              cross={crossMatchups.length}
              generatedAt={schedule.generatedAt}
            />

            <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
              <div className="flex-1 min-w-0">
                <ScheduleGrid weeks={byWeek} onSwap={handleSwap} />
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
                        onClick={() =>
                          setSelectedTeamId((prev) => (prev === team.id ? null : team.id))
                        }
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
                  <TeamLog
                    matchups={selectedTeamMatchups}
                    teamId={selectedTeamId}
                    teams={allTeams}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Sync modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#141415] border border-[#2a2a2c] rounded-lg p-6 w-full max-w-sm">
            <h2 className="text-sm font-medium mb-1">Sync Sleeper League</h2>
            <p className="text-xs mb-4" style={{ color: '#555' }}>
              Paste your Sleeper league ID to add or update it.
            </p>
            <input
              type="text"
              value={syncInput}
              onChange={(e) => setSyncInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSync(syncInput)}
              placeholder="e.g. 123456789"
              autoFocus
              className="w-full bg-[#0e0e0f] border border-[#2a2a2c] rounded px-3 py-2 text-xs
                         text-[#e8e6df] placeholder-[#444] focus:outline-none focus:border-[#444] mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowSyncModal(false); setSyncInput(''); }}
                className="px-3 py-1.5 text-xs text-[#666] hover:text-[#e8e6df] transition-colors touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSync(syncInput)}
                disabled={syncing || !syncInput.trim()}
                className="px-3 py-1.5 text-xs bg-[#e8e6df] text-[#0e0e0f] rounded font-medium
                           hover:bg-white transition-colors disabled:opacity-40 touch-manipulation"
              >
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#141415] border border-[#2a2a2c] rounded-lg p-6 w-full max-w-sm">
            <h2 className="text-sm font-medium mb-1">Clear schedule?</h2>
            <p className="text-xs mb-6" style={{ color: '#555' }}>
              This will permanently delete all matchups for{' '}
              <span style={{ color: '#e8e6df' }}>{activeLeague?.name ?? 'this league'}</span>.
              You can regenerate a new schedule afterwards.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
                className="px-3 py-1.5 text-xs text-[#666] hover:text-[#e8e6df] transition-colors
                           disabled:opacity-40 touch-manipulation"
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                disabled={clearing}
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
    </main>
  );
}