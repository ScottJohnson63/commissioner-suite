'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MatchupPair, MatchupTeam } from '@/app/api/sleeper/matchups/route';

// ─── Matchup card ─────────────────────────────────────────────────────────────

function MatchupCard({ pair }: { pair: MatchupPair }) {
  const played = pair.home.points > 0 || pair.away.points > 0;
  const homeWins = played && pair.home.points > pair.away.points;
  const awayWins = played && pair.away.points > pair.home.points;

  function Team({ team, winner }: { team: MatchupTeam; winner: boolean }) {
    return (
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${winner ? 'rounded-t-lg' : 'rounded-b-lg'}`}
        style={{ background: winner && played ? 'rgba(128,255,73,0.06)' : 'transparent' }}>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: winner && played ? '#80ff49' : '#e8e6df' }}>
            {team.teamName}
          </p>
          {team.teamName !== team.displayName && (
            <p className="text-[11px] truncate" style={{ color: '#555' }}>{team.displayName}</p>
          )}
          <p className="text-[11px] mt-0.5" style={{ color: '#444' }}>
            {team.wins}–{team.losses}
          </p>
        </div>
        <div className="text-right shrink-0">
          {played ? (
            <span className="text-lg font-semibold tabular-nums"
              style={{ color: winner ? '#80ff49' : '#888' }}>
              {team.points.toFixed(2)}
            </span>
          ) : (
            <span className="text-xs" style={{ color: '#444' }}>TBD</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e1e20', background: '#141415' }}>
      <div className="border-b" style={{ borderColor: '#1e1e20' }}>
        <Team team={pair.home} winner={homeWins} />
      </div>
      <Team team={pair.away} winner={awayWins} />
    </div>
  );
}

// ─── Schedule page ────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState<string>('');
  const [week, setWeek] = useState(1);
  const [matchups, setMatchups] = useState<MatchupPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noLeague, setNoLeague] = useState(false);

  // Load active league from localStorage
  useEffect(() => {
    const id = localStorage.getItem('sleeper_active_league');
    const name = localStorage.getItem('sleeper_active_league_name') ?? '';
    if (!id) { setNoLeague(true); return; }
    setLeagueId(id);
    setLeagueName(name);

    // Guess current week from stored data or default to 1
    const savedWeek = localStorage.getItem('schedule_week');
    if (savedWeek) setWeek(Number(savedWeek));
  }, []);

  const fetchMatchups = useCallback(async (lid: string, w: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sleeper/matchups?leagueId=${lid}&week=${w}`);
      const data = await res.json() as MatchupPair[] | { error: string };
      if (!res.ok) throw new Error((data as { error: string }).error);
      setMatchups(data as MatchupPair[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matchups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (leagueId) void fetchMatchups(leagueId, week);
  }, [leagueId, week, fetchMatchups]);

  function changeWeek(delta: number) {
    const next = Math.max(1, Math.min(18, week + delta));
    setWeek(next);
    localStorage.setItem('schedule_week', String(next));
  }

  // ── No league connected ──────────────────────────────────────────────────
  if (noLeague) {
    return (
      <div className="min-h-full flex items-center justify-center px-5 py-12" style={{ color: '#e8e6df' }}>
        <div className="text-center max-w-xs">
          <p className="text-2xl mb-3">📅</p>
          <h2 className="text-base font-medium mb-2">No league connected</h2>
          <p className="text-sm mb-4" style={{ color: '#555' }}>
            Connect your Sleeper account from the Dashboard to view your schedule.
          </p>
          <a href="/league/dashboard"
            className="text-xs px-3 py-1.5 rounded border transition-colors inline-block"
            style={{ borderColor: '#2a2a2c', color: '#888' }}>
            ← Go to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-5 py-6 sm:px-8" style={{ color: '#e8e6df' }}>

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#555' }}>
            Schedule
          </p>
          <h1 className="text-xl font-semibold">
            {leagueName || 'League Schedule'}
          </h1>
        </div>

        {/* Week navigation */}
        <div className="overflow-x-auto w-full sm:w-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-1 min-w-max">
            <button
              onClick={() => changeWeek(-1)}
              disabled={week <= 1}
              className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30 shrink-0"
              style={{ background: '#141415', border: '1px solid #1e1e20', color: '#888' }}
            >
              ‹
            </button>
            <div className="flex gap-1 flex-nowrap">
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <button
                  key={w}
                  onClick={() => { setWeek(w); localStorage.setItem('schedule_week', String(w)); }}
                  className="w-8 h-8 rounded text-xs transition-colors shrink-0"
                  style={{
                    background: w === week ? '#80ff49' : '#141415',
                    border: `1px solid ${w === week ? '#80ff49' : '#1e1e20'}`,
                    color: w === week ? '#0e0e0f' : '#555',
                    fontWeight: w === week ? 600 : 400,
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
            <button
              onClick={() => changeWeek(1)}
              disabled={week >= 18}
              className="w-8 h-8 rounded flex items-center justify-center text-sm transition-colors disabled:opacity-30 shrink-0"
              style={{ background: '#141415', border: '1px solid #1e1e20', color: '#888' }}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl h-28 animate-pulse"
              style={{ background: '#141415', border: '1px solid #1e1e20' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl p-5 text-sm" style={{ background: '#141415', border: '1px solid rgba(255,73,73,0.2)', color: '#ff4949' }}>
          {error}
          <button onClick={() => leagueId && void fetchMatchups(leagueId, week)}
            className="ml-3 text-xs transition-colors" style={{ color: '#555' }}>
            ↺ Retry
          </button>
        </div>
      )}

      {!loading && !error && matchups.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ background: '#141415', border: '1px solid #1e1e20' }}>
          <p className="text-sm" style={{ color: '#555' }}>No matchups found for Week {week}.</p>
        </div>
      )}

      {!loading && !error && matchups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {matchups.map((pair) => (
            <MatchupCard key={pair.matchupId} pair={pair} />
          ))}
        </div>
      )}
    </div>
  );
}
