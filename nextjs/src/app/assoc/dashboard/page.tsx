'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ScheduleGrid } from '@/components/ScheduleGrid';
import { StatCards } from '@/components/StatCards';
import { TeamLog } from '@/components/TeamLog';
import { LeagueSwitcher } from '@/components/LeagueSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'schedules' | 'divisions' | 'lottery';

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

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'schedules', label: 'Schedules' },
  { id: 'divisions', label: 'Divisions' },
  { id: 'lottery',   label: 'Lottery'   },
];

// ─── Schedules Tab ────────────────────────────────────────────────────────────

function SchedulesTab({
  activeLeagueId,
  refreshKey,
}: {
  activeLeagueId: string | null;
  refreshKey: number;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchSchedule = useCallback(async (leagueId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/schedule`);
      if (res.status === 404) { setSchedule(null); return; }
      if (!res.ok) throw new Error('Failed to load schedule');
      setSchedule(await res.json() as Schedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeLeagueId) fetchSchedule(activeLeagueId);
    else setSchedule(null);
  }, [activeLeagueId, refreshKey, fetchSchedule]);

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

  async function handleSwap(matchupId: string, homeTeamId: string, awayTeamId: string): Promise<void> {
    const res = await fetch(`/api/matchups/${matchupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeTeamId: awayTeamId, awayTeamId: homeTeamId }),
    });
    if (!res.ok) throw new Error('Swap failed');
    if (activeLeagueId) await fetchSchedule(activeLeagueId);
  }

  const byWeek = schedule
    ? Array.from({ length: 13 }, (_, i) => schedule.matchups.filter((m) => m.week === i + 1))
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
  const crossMatchups    = schedule?.matchups.filter((m) => m.type === 'cross-division') ?? [];

  const selectedTeamMatchups = selectedTeamId
    ? schedule?.matchups.filter(
        (m) => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId,
      ) ?? []
    : [];

  return (
    <div className="max-w-5xl">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
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

      {/* Error banner */}
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

      {/* Loading skeleton */}
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

      {/* Empty state */}
      {!loading && !schedule && activeLeagueId && (
        <p className="text-xs text-center py-20" style={{ color: '#555' }}>
          No schedule yet. Generate one above.
        </p>
      )}

      {/* No league selected */}
      {!activeLeagueId && (
        <p className="text-xs text-center py-20" style={{ color: '#555' }}>
          Sync a league to get started.
        </p>
      )}

      {/* Schedule content */}
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

      {/* Clear confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#141415] border border-[#2a2a2c] rounded-lg p-6 w-full max-w-sm">
            <h2 className="text-sm font-medium mb-1">Clear schedule?</h2>
            <p className="text-xs mb-6" style={{ color: '#555' }}>
              This will permanently delete all matchups for this league. You can regenerate afterwards.
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
    </div>
  );
}

// ─── Divisions Tab ────────────────────────────────────────────────────────────

interface StandingEntry {
  rank: number;
  rosterId: number;
  name: string;
  ownerName: string | null;
  isChampion: boolean;
  division: 1 | 2;
}

interface StandingsResponse {
  standings: StandingEntry[];
}

function DivisionsTab({ activeLeagueId }: { activeLeagueId: string | null }) {
  const [standings, setStandings] = useState<StandingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (leagueId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/assoc/standings?leagueId=${encodeURIComponent(leagueId)}`);
      const data = await res.json() as StandingsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load standings');
      setStandings(data.standings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load standings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStandings([]);
    setError(null);
    if (activeLeagueId) void load(activeLeagueId);
  }, [activeLeagueId, load]);

  const div1 = standings.filter((s) => s.division === 1);
  const div2 = standings.filter((s) => s.division === 2);

  const DIV_COLORS: Record<1 | 2, string> = { 1: '#c849ff', 2: '#ff6d49' };

  return (
    <div className="max-w-3xl">

      {/* Error */}
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

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((d) => (
            <div key={d} className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e20' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: '#1e1e20', background: '#141415' }}>
                <div className="h-3 w-24 rounded animate-pulse" style={{ background: '#2a2a2c' }} />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: '#1a1a1c' }}>
                  <div className="h-3 w-4 rounded animate-pulse" style={{ background: '#1e1e20' }} />
                  <div className="h-3 flex-1 rounded animate-pulse" style={{ background: '#1e1e20' }} />
                  <div className="h-3 w-12 rounded animate-pulse" style={{ background: '#1e1e20' }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && standings.length === 0 && !error && (
        <p className="text-xs text-center py-16" style={{ color: '#444' }}>
          {activeLeagueId ? 'No standings data found for this league.' : 'Select a league to get started.'}
        </p>
      )}

      {/* Divisions */}
      {!loading && standings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([1, 2] as const).map((divId) => {
            const teams = divId === 1 ? div1 : div2;
            const accent = DIV_COLORS[divId];
            return (
              <div key={divId} className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e20', background: '#141415' }}>
                <div className="px-4 py-3 border-b flex items-center gap-2"
                  style={{ borderColor: '#1e1e20' }}>
                  <p className="text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: accent }}>
                    Division {divId}
                  </p>
                  <span className="text-[10px]" style={{ color: '#444' }}>
                    {teams.length} teams · {divId === 1 ? 'odd ranks' : 'even ranks'}
                  </span>
                </div>
                <div>
                  {teams.map((team) => (
                    <div
                      key={team.rosterId}
                      className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
                      style={{ borderColor: '#1a1a1c' }}
                    >
                      {/* Rank */}
                      <span className="w-5 text-right text-[11px] tabular-nums shrink-0"
                        style={{ color: '#444' }}>
                        {team.rank}
                      </span>

                      {/* Champion crown */}
                      {team.isChampion ? (
                        <span className="shrink-0 text-sm" title="Champion">♛</span>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}

                      {/* Name */}
                      <span className="flex-1 text-xs truncate min-w-0" style={{ color: '#e8e6df' }}>
                        {team.name}
                        {team.ownerName && (
                          <span className="ml-1" style={{ color: '#555' }}>({team.ownerName})</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!loading && standings.length > 0 && (
        <p className="mt-4 text-[10px]" style={{ color: '#444' }}>
          ♛ Champion · Rankings from final bracket results
        </p>
      )}
    </div>
  );
}

// ─── Lottery Tab ──────────────────────────────────────────────────────────────

const LOTTERY_TOTAL       = 1_000_000;
const LOTTERY_DURATION_MS = 180_000; // ~3 minutes
const LOTTERY_INTERVAL_MS = 50;
const LOTTERY_BATCH       = Math.ceil(LOTTERY_TOTAL / (LOTTERY_DURATION_MS / LOTTERY_INTERVAL_MS));

const PICK_ACCENT  = ['#facc15', '#aaaaaa', '#cd7f32'] as const;
const PICK_LABEL   = ['1st Overall Pick', '2nd Overall Pick', '3rd Overall Pick'] as const;
const LIVE_ACCENTS = ['#80ff49', '#facc15', '#ff6d49'] as const;

interface LotteryResult {
  rosterId:  number;
  name:      string;
  ownerName: string | null;
  prevRank:  number;
  count:     number;
  pick:      number;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function LotteryTab({ activeLeagueId }: { activeLeagueId: string | null }) {
  const [standings, setStandings]   = useState<StandingEntry[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [running, setRunning]       = useState(false);
  const [results, setResults]       = useState<LotteryResult[] | null>(null);
  const [totalDrawn, setTotalDrawn] = useState(0);
  const [liveCounts, setLiveCounts] = useState<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const load = useCallback(async (leagueId: string) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res  = await fetch(`/api/assoc/standings?leagueId=${encodeURIComponent(leagueId)}`);
      const data = await res.json() as StandingsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load standings');
      setStandings(data.standings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load standings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStandings([]);
    setError(null);
    setResults(null);
    setRunning(false);
    setTotalDrawn(0);
    setLiveCounts([]);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (activeLeagueId) void load(activeLeagueId);
  }, [activeLeagueId, load]);

  // 3 worst teams from consolation bracket = highest rank numbers
  const worstTeams = useMemo(
    () => [...standings].sort((a, b) => b.rank - a.rank).slice(0, 3),
    [standings],
  );

  function runLottery() {
    if (worstTeams.length === 0) return;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    const n      = worstTeams.length;
    const counts = new Array<number>(n).fill(0);
    let   drawn  = 0;

    setRunning(true);
    setResults(null);
    setTotalDrawn(0);
    setLiveCounts([...counts]);

    intervalRef.current = setInterval(() => {
      const thisBatch = Math.min(LOTTERY_BATCH, LOTTERY_TOTAL - drawn);
      for (let i = 0; i < thisBatch; i++) {
        counts[Math.floor(Math.random() * n)]++;
      }
      drawn += thisBatch;
      setTotalDrawn(drawn);
      setLiveCounts([...counts]);

      if (drawn >= LOTTERY_TOTAL) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        const sorted: LotteryResult[] = worstTeams
          .map((team, idx) => ({
            rosterId:  team.rosterId,
            name:      team.name,
            ownerName: team.ownerName,
            prevRank:  team.rank,
            count:     counts[idx],
            pick:      0,
          }))
          .sort((a, b) => b.count - a.count)
          .map((r, i) => ({ ...r, pick: i + 1 }));
        setResults(sorted);
        setRunning(false);
      }
    }, LOTTERY_INTERVAL_MS);
  }

  const progressPct = (totalDrawn / LOTTERY_TOTAL) * 100;
  const drawsPerMs  = LOTTERY_BATCH / LOTTERY_INTERVAL_MS;
  const msRemaining = running ? (LOTTERY_TOTAL - totalDrawn) / drawsPerMs : 0;

  // Fixed row order; compute dynamic rank position for badge colors
  const liveTeams = useMemo(
    () => worstTeams.map((team, idx) => ({ ...team, count: liveCounts[idx] ?? 0 })),
    [worstTeams, liveCounts],
  );
  const liveRankOf = useMemo(() => {
    const sorted = [...liveTeams].sort((a, b) => b.count - a.count);
    return new Map(sorted.map((t, i) => [t.rosterId, i]));
  }, [liveTeams]);
  const maxLiveCount = useMemo(
    () => Math.max(1, ...liveTeams.map((t) => t.count)),
    [liveTeams],
  );

  return (
    <div className="max-w-xl">

      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2 rounded text-xs border"
          style={{ background: 'rgba(255,73,73,0.08)', color: '#ff4949', borderColor: 'rgba(255,73,73,0.2)' }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded animate-pulse"
              style={{ background: '#141415', border: '1px solid #1e1e20' }} />
          ))}
        </div>
      )}

      {/* No league */}
      {!activeLeagueId && !loading && (
        <p className="text-xs text-center py-16" style={{ color: '#444' }}>
          Select a league to get started.
        </p>
      )}

      {/* Pre-lottery: eligible teams */}
      {!loading && !running && !results && worstTeams.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#555' }}>
            Lottery Eligible · Previous Season Bottom 3
          </p>
          <div className="rounded-lg overflow-hidden mb-6"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            {worstTeams.map((team) => (
              <div key={team.rosterId}
                className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
                style={{ borderColor: '#1a1a1c' }}>
                <span className="text-[10px] w-16 shrink-0 tabular-nums" style={{ color: '#555' }}>
                  Rank #{team.rank}
                </span>
                <span className="flex-1 text-xs truncate" style={{ color: '#e8e6df' }}>
                  {team.name}
                  {team.ownerName && (
                    <span className="ml-1" style={{ color: '#555' }}>({team.ownerName})</span>
                  )}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: '#444' }}>
                  1 in {worstTeams.length} odds
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={runLottery}
            className="px-6 py-2.5 rounded text-sm font-medium transition-colors"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
          >
            Run Draft Lottery
          </button>
        </>
      )}

      {/* Running: live animated progress */}
      {running && (
        <div>
          {/* Overall progress bar */}
          <div className="mb-7">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest" style={{ color: '#80ff49' }}>
                Drawing…
              </p>
              <span className="text-[10px] tabular-nums" style={{ color: '#555' }}>
                ~{formatCountdown(msRemaining)} remaining
              </span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#1e1e20' }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #80ff49 0%, #c849ff 100%)',
                  transition: 'width 0.05s linear',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] tabular-nums" style={{ color: '#444' }}>
                {totalDrawn.toLocaleString()} / {LOTTERY_TOTAL.toLocaleString()} draws
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: '#444' }}>
                {progressPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Live team standings — fixed row order, dynamic rank badge + bar */}
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#444' }}>
            Live Standings
          </p>
          <div className="rounded-lg overflow-hidden"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            {liveTeams.map((team) => {
              const rank   = liveRankOf.get(team.rosterId) ?? 0; // 0-based
              const accent = LIVE_ACCENTS[rank];
              const barPct = (team.count / maxLiveCount) * 100;
              const pct    = totalDrawn > 0
                ? ((team.count / totalDrawn) * 100).toFixed(2)
                : '0.00';
              return (
                <div key={team.rosterId}
                  className="px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: '#1a1a1c' }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-base font-bold tabular-nums shrink-0 w-5 text-center"
                      style={{ color: accent, transition: 'color 0.3s' }}>
                      {rank + 1}
                    </span>
                    <span className="flex-1 text-xs truncate" style={{ color: '#e8e6df' }}>
                      {team.name}
                      {team.ownerName && (
                        <span className="ml-1" style={{ color: '#555' }}>({team.ownerName})</span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums font-semibold shrink-0"
                      style={{ color: accent, transition: 'color 0.3s' }}>
                      {team.count.toLocaleString()}
                    </span>
                    <span className="text-[10px] tabular-nums shrink-0 w-12 text-right"
                      style={{ color: '#444' }}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden ml-8"
                    style={{ background: '#1e1e20' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barPct}%`,
                        background: accent,
                        transition: 'width 0.05s linear, background 0.3s',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {results && !running && (
        <>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#555' }}>
            Lottery Results · 1,000,000 draws
          </p>
          <div className="flex flex-col gap-2 mb-6">
            {results.map((r) => {
              const accent = PICK_ACCENT[r.pick - 1];
              const label  = PICK_LABEL[r.pick - 1];
              const pct    = ((r.count / LOTTERY_TOTAL) * 100).toFixed(2);
              return (
                <div key={r.rosterId}
                  className="rounded-lg px-4 py-3.5 flex items-center gap-4"
                  style={{
                    background: '#141415',
                    border: `1px solid ${r.pick === 1 ? `${accent}44` : '#1e1e20'}`,
                  }}>
                  <span className="text-xl font-bold tabular-nums shrink-0 w-6 text-center"
                    style={{ color: accent }}>
                    {r.pick}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#e8e6df' }}>
                      {r.name}
                      {r.ownerName && (
                        <span className="ml-1 text-xs font-normal" style={{ color: '#555' }}>
                          ({r.ownerName})
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#555' }}>
                      {label} · prev rank #{r.prevRank}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums" style={{ color: accent }}>
                      {r.count.toLocaleString()}
                    </p>
                    <p className="text-[10px] tabular-nums" style={{ color: '#444' }}>{pct}%</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Distribution bars */}
          <div className="rounded-lg px-4 py-3 mb-6"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#444' }}>
              Draw Distribution
            </p>
            <div className="flex flex-col gap-2.5">
              {results.map((r) => {
                const accent = PICK_ACCENT[r.pick - 1];
                const pct    = (r.count / LOTTERY_TOTAL) * 100;
                return (
                  <div key={r.rosterId} className="flex items-center gap-3">
                    <span className="text-[10px] truncate w-28 shrink-0" style={{ color: '#888' }}>
                      {r.name}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e1e20' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: accent }} />
                    </div>
                    <span className="text-[10px] tabular-nums w-12 text-right shrink-0"
                      style={{ color: '#555' }}>
                      {pct.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={runLottery}
              className="px-4 py-2 rounded text-sm font-medium transition-colors"
              style={{ background: '#80ff49', color: '#0e0e0f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
            >
              ↻ Re-run Lottery
            </button>
            <button
              onClick={() => { setResults(null); setTotalDrawn(0); setLiveCounts([]); }}
              className="px-4 py-2 rounded text-sm font-medium border transition-colors"
              style={{ borderColor: '#2a2a2c', color: '#888' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
            >
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Types for Sleeper session ────────────────────────────────────────────────

interface SleeperLeague {
  leagueId: string;
  name: string;
  season: number;
}

interface SleeperUser {
  userId: string;
  leagues: SleeperLeague[];
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function AssocDashboardPage() {
  const [tab, setTab] = useState<Tab>('schedules');
  const [sleeperLeagues, setSleeperLeagues] = useState<SleeperLeague[]>([]);
  const [dbLeagues, setDbLeagues] = useState<League[]>([]);
  const [activeSleeperLeagueId, setActiveSleeperLeagueId] = useState<string | null>(null);

  // Derive the internal DB id from whichever Sleeper league is selected
  const activeLeagueId =
    dbLeagues.find((l) => l.sleeperLeagueId === activeSleeperLeagueId)?.id ?? null;

  // Restore Sleeper session from localStorage — same pattern as league/dashboard
  useEffect(() => {
    const userId   = localStorage.getItem('sleeper_user_id');
    const username = localStorage.getItem('sleeper_username');
    if (!userId && !username) return;

    void (async () => {
      try {
        const param = userId
          ? `userId=${encodeURIComponent(userId)}`
          : `username=${encodeURIComponent(username!)}`;
        const res = await fetch(`/api/sleeper/user?${param}`);
        if (!res.ok) return;
        const data = await res.json() as SleeperUser;
        setSleeperLeagues(data.leagues);
        const saved = localStorage.getItem('sleeper_active_league');
        setActiveSleeperLeagueId(saved ?? data.leagues[0]?.leagueId ?? null);
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch DB leagues for sleeperLeagueId → internal id cross-reference
  useEffect(() => {
    void fetch('/api/leagues')
      .then((r) => r.json())
      .then((data) => setDbLeagues(data as League[]));
  }, []);

  function handleLeagueSelect(sleeperLeagueId: string) {
    setActiveSleeperLeagueId(sleeperLeagueId);
    localStorage.setItem('sleeper_active_league', sleeperLeagueId);
  }

  // Adapt Sleeper leagues to the shape LeagueSwitcher expects
  const switcherLeagues = sleeperLeagues.map((l) => ({
    id: l.leagueId,
    sleeperLeagueId: l.leagueId,
    name: l.name,
    season: l.season,
  }));

  return (
    <div className="min-h-full px-5 py-6 sm:px-8" style={{ color: '#e8e6df' }}>
      {/* Header */}
      <div className="grid grid-cols-3 items-center gap-3 mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#555' }}>
            Commissioner Suite
          </p>
          <h1 className="text-xl font-semibold">Dashboard</h1>
        </div>

        <div className="flex justify-center">
          <Link
            href="/log"
            className="text-xs transition-colors touch-manipulation hover:text-[#e8e6df]"
            style={{ color: '#555' }}
          >
            Activity Log →
          </Link>
        </div>

        <div className="flex items-center justify-end">
          <LeagueSwitcher
            leagues={switcherLeagues}
            activeId={activeSleeperLeagueId}
            onChange={handleLeagueSelect}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-6" style={{ borderColor: '#1e1e20' }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: tab === id ? '#e8e6df' : '#555',
              borderBottom: `2px solid ${tab === id ? '#80ff49' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'schedules' && <SchedulesTab activeLeagueId={activeLeagueId} refreshKey={0} />}
      {tab === 'divisions' && <DivisionsTab activeLeagueId={activeLeagueId} />}
      {tab === 'lottery'   && <LotteryTab activeLeagueId={activeLeagueId} />}
    </div>
  );
}
