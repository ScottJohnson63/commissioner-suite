'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  // Add to your useState block at the top of DashboardPage:
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(
    new Set(Array.from({ length: 13}, (_, i) => i + 1))
  );

  function toggleWeek(week: number): void {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      next.has(week) ? next.delete(week) : next.add(week);
      return next;
    });
  }

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
      if (res.status === 404) {
        setSchedule(null);
        return;
      }
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

  // ── Actions
  async function handleSync(): Promise<void> {
    const leagueIds = leagues.map((l) => l.sleeperLeagueId);
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/leagues/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds }),
      });
      if (!res.ok) throw new Error('Sync failed');
      setLastSynced(new Date());
      if (activeLeagueId) await fetchSchedule(activeLeagueId);
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
      const res = await fetch(`/api/leagues/${activeLeagueId}/schedule`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Schedule generation failed');
      await fetchSchedule(activeLeagueId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
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
    ? schedule?.matchups
        .filter((m) => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
        .sort((a, b) => a.week - b.week) ?? []
    : [];

  const activeLeague = leagues.find((l) => l.id === activeLeagueId);

  return (
    <main className="min-h-screen bg-[#0e0e0f] text-[#e8e6df] font-mono">

      {/* ── Top bar */}
      <header className="border-b border-[#2a2a2c] px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-xs tracking-[0.2em] uppercase font-medium">
            Commissioner
          </span>
          <LeagueSwitcher
            leagues={leagues}
            activeId={activeLeagueId}
            onChange={setActiveLeagueId}
          />
        </div>

        <div className="flex items-center gap-3">
          {lastSynced && (
            <span className="text-[11px]" style={{ color: '#80ff49' }}>
              synced {lastSynced.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:text-[#80ff49] hover:border-[#80ff49] transition-colors disabled:opacity-40"
          >
            {syncing ? 'Syncing…' : '↻ Sync Sleeper'}
          </button>
          <button
            onClick={handleExport}
            disabled={!schedule}
            className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:text-[#80ff49] hover:border-[#80ff49] transition-colors disabled:opacity-40"
          >
            ↓ Export CSV
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || !activeLeagueId}
            className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:text-[#80ff49] hover:border-[#80ff49] transition-colors disabled:opacity-40"
          >
            {generating ? 'Generating…' : schedule ? '⟳ Regenerate' : '+ Generate Schedule'}
          </button>
        </div>
      </header>

      <div className="px-8 py-6">

        {/* ── Error banner */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-[#2a1515] border border-[#5a2020] rounded text-[#f87171] text-xs">
            {error}
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ── Season heading */}
        {activeLeague && (
          <div className="mb-8">
            <h1 className="text-2xl font-medium tracking-tight">
              {activeLeague.name}
            </h1>
            <p className="text-sm mt-1" style={{ color: '#80ff49' }}>
              {activeLeague.season} season &middot; 13 weeks &middot; 2 divisions
            </p>
          </div>
        )}

        {loading && (
          <div className=" text-sm">Loading schedule…</div>
        )}

        {!loading && !schedule && activeLeagueId && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className=" mb-4">No schedule generated yet.</p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: '#80ff49', color: '#0e0e0f' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#9fff6e')}
              onMouseLeave={e => (e.currentTarget.style.background = '#80ff49')}
            >
              {generating ? 'Generating…' : '+ Generate Schedule'}
            </button>
          </div>
        )}

        {!loading && schedule && (
          <>
            {/* ── Stat cards */}
            <StatCards
              total={schedule.matchups.length}
              division={divisionMatchups.length}
              cross={crossMatchups.length}
              generatedAt={schedule.generatedAt}
            />

            <div className="mt-8 flex gap-6 items-start">

            {/* ── Schedule grid */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-1">
                {byWeek.map((matchups, i) => {
                  const week = i + 1;
                  const isOpen = expandedWeeks.has(week);

                  return (
                    <div key={week} className="border border-[#2a2a2c] rounded">
                      {/* Week header / toggle */}
                      <button
                        onClick={() => toggleWeek(week)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-[#1a1a1c] transition-colors"
                      >
                        <span className="tracking-widest uppercase" style={{ color: '#80ff49' }}>
                          Week {week}
                        </span>
                        <div className="flex items-center gap-3" style={{ color: '#80ff49' }}>
                          <span>{matchups.length} games</span>
                          <span className="transition-transform duration-200" style={{ display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                            ▾
                          </span>
                        </div>
                      </button>

                      {/* Matchup rows */}
                      {isOpen && (
                        <div className="border-t border-[#2a2a2c] divide-y divide-[#1e1e20]">
                          {matchups.length === 0 ? (
                            <p className="px-4 py-3  text-xs">No games scheduled.</p>
                          ) : (
                            matchups.map((m, gameIdx) => (
                              <div
                                key={m.id}
                                className="flex items-center justify-between px-4 py-2.5 text-xs group"
                              >
                                {/* Game number */}
                                <span className=" w-6 shrink-0">
                                  {gameIdx + 1}
                                </span>

                                {/* Teams */}
                                <div className="flex-1 flex items-center gap-2 min-w-0">
                                  <span className="text-[#e8e6df] truncate">{m.homeTeam.name}</span>
                                  <span className="shrink-0">vs</span>
                                  <span className="text-[#e8e6df] truncate">{m.awayTeam.name}</span>
                                </div>

                                {/* Type badge */}
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded text-[10px] ml-3"
                                  style={
                                    m.type === 'division'
                                      ? { background: 'rgba(200,73,255,0.15)', color: '#c849ff' }
                                      : { background: 'rgba(255,109,73,0.15)', color: '#ff6d49' }
                                  }
                                >
                                  {m.type === 'division' ? 'DIV' : 'X-DIV'}
                                </span>

                                {/* Swap button */}
                                <button
                                  onClick={() => handleSwap(m.id, m.homeTeamId, m.awayTeamId)}
                                  className="ml-3 shrink-0 opacity-0 group-hover:opacity-100  hover:text-[#e8e6df] transition-all"
                                  title="Swap home/away"
                                >
                                  ⇄
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

              {/* ── Team log sidebar */}
              <div className="w-64 shrink-0">
                <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#80ff49' }}>
                  Team schedule
                </p>
                <div className="flex flex-col gap-1 mb-4">
                  {allTeams
                    .sort((a, b) => a.divisionId - b.divisionId || a.name.localeCompare(b.name))
                    .map((team) => (
                      <button
                        key={team.id}
                        onClick={() =>
                          setSelectedTeamId((prev) => (prev === team.id ? null : team.id))
                        }
                        className={`text-left px-3 py-1.5 rounded text-xs transition-colors ${
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
    </main>
  );
}