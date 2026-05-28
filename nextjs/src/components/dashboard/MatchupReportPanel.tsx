'use client';

import { useState } from 'react';
import type { MatchupReportResponse } from '@/types/projections';
import { PANEL_BG, INNER_BG, PanelActionBtn, PanelSkeleton, NoLeague, PlayerAvatar } from './shared';

export function MatchupReportPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<MatchupReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/sleeper/matchup-report?leagueId=${leagueId}&userId=${userId}`);
      const json = await res.json() as MatchupReportResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load matchup report');
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">⚔️</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Matchup Analysis</p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Analyze Matchup" loadingLabel="Analyzing…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 rounded animate-pulse" style={{ background: '#1e1e20' }} />
            <div className="h-20 rounded animate-pulse" style={{ background: '#1e1e20' }} />
          </div>
          <PanelSkeleton rows={2} height={14} />
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'myTeam', team: data.myTeam },
                { key: 'opponent', team: data.opponent },
              ] as const
            ).map(({ key, team }) => (
              <div key={key} className="rounded-lg p-3 flex flex-col gap-1" style={{
                ...INNER_BG,
                border: `1px solid ${key === 'myTeam' ? 'rgba(128,255,73,0.25)' : '#1e1e20'}`,
              }}>
                <p className="text-[10px] uppercase tracking-wider truncate"
                  style={{ color: key === 'myTeam' ? '#80ff49' : '#555' }}>
                  {team.name}
                </p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: '#e8e6df' }}>
                  {team.projected.toFixed(1)}
                </p>
                <div className="flex gap-2 text-[10px] tabular-nums">
                  <span style={{ color: '#ff6d49' }}>↓{team.floor.toFixed(1)}</span>
                  <span style={{ color: '#2a2a2c' }}>·</span>
                  <span style={{ color: '#80ff49' }}>↑{team.ceiling.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>

          {(data.vegasLines || data.weather) && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              {data.vegasLines?.slice(0, 3).map((l, i) => (
                <span key={i} className="px-2 py-1 rounded flex items-center gap-1"
                  style={{ background: '#1e1e20', color: '#555' }}>
                  {l.sport && (
                    <span className="font-semibold" style={{ color: '#facc15' }}>{l.sport}</span>
                  )}
                  {l.sport
                    ? `${l.homeTeam.split(' ').at(-1)} vs ${l.awayTeam.split(' ').at(-1)} · O/U ${l.total}`
                    : `O/U ${l.total} · ${l.spread > 0 ? '+' : ''}${l.spread}`}
                </span>
              ))}
              {data.weather?.map((w, i) => (
                <span key={i} className="px-2 py-1 rounded"
                  style={{
                    background: '#1e1e20',
                    color: w.windMph > 20 || w.precipPct > 60 ? '#facc15' : '#555',
                  }}>
                  {w.team}: {w.tempF}°F · {w.windMph}mph · {w.precipPct}% rain
                </span>
              ))}
            </div>
          )}

          {data.narrative && (
            <p className="text-xs leading-relaxed" style={{ color: '#888' }}>
              {data.narrative}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: data.myTeam.name, players: data.myPlayers, accent: '#80ff49' },
              { label: data.opponent.name, players: data.opponentPlayers, accent: '#555' },
            ].map(({ label, players, accent }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider mb-1.5 truncate"
                  style={{ color: accent }}>{label}</p>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e20' }}>
                  {players.slice(0, 9).map((p) => (
                    <div key={p.playerId}
                      className="flex items-center justify-between px-2 py-1.5 border-b last:border-b-0 gap-2"
                      style={{ borderColor: '#1a1a1c' }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar
                          playerId={p.sleeperPlayerId}
                          name={p.name}
                          size={26}
                        />
                        <span className="text-[9px] px-1 rounded shrink-0"
                          style={{ background: '#1e1e20', color: '#555' }}>
                          {p.position}
                        </span>
                        <span className="text-[11px] truncate" style={{ color: '#e8e6df' }}>
                          {p.name}
                        </span>
                        {p.weatherNote && (
                          <span className="text-[9px] shrink-0" style={{ color: '#facc15' }}>⚠</span>
                        )}
                      </div>
                      <span className="text-[11px] tabular-nums shrink-0"
                        style={{ color: accent }}>
                        {p.floor.toFixed(0)}–{p.ceiling.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
