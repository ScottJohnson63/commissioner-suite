'use client';

import { useState } from 'react';
import type { TradeSuggestionsResponse } from '@/types/suggestions';
import { PANEL_BG, INNER_BG, PanelActionBtn, PanelSkeleton, NoLeague } from './shared';

export function TradeAnalyzerPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<TradeSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/sleeper/trade-suggestions?leagueId=${leagueId}&userId=${userId}&season=2025`,
      );
      if (!res.ok) throw new Error('Failed to load trades');
      setData(await res.json() as TradeSuggestionsResponse);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">🔄</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Trade Finder</p>
            <p className="text-[10px] truncate" style={{ color: '#555' }}>
              Realistic trades that address your roster needs
            </p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Analyze Trades" loadingLabel="Loading…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && <PanelSkeleton rows={3} height={56} />}

      {data && !loading && (
        <>
          {Object.keys(data.myPositionRanks).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: '#555' }}>
                Your ranks:
              </span>
              {Object.entries(data.myPositionRanks).map(([pos, rank]) => (
                <span key={pos} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: rank <= 3  ? 'rgba(128,255,73,0.12)'
                              : rank <= 6  ? 'rgba(250,204,21,0.12)'
                              :              'rgba(255,73,73,0.12)',
                    color: rank <= 3 ? '#80ff49' : rank <= 6 ? '#facc15' : '#ff4949',
                  }}>
                  {pos} #{rank}
                </span>
              ))}
            </div>
          )}

          {data.proposals.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: '#444' }}>
              No fair trades found — try again after more games are played
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.proposals.map((p, i) => (
                <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={INNER_BG}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                      {p.targetTeamName}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-14 h-1.5 rounded-full overflow-hidden"
                        style={{ background: '#1e1e20' }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${p.fairnessScore}%`,
                          background: p.fairnessScore >= 75 ? '#80ff49'
                                    : p.fairnessScore >= 50 ? '#facc15'
                                    : '#ff4949',
                        }} />
                      </div>
                      <span className="text-[10px] tabular-nums w-5 text-right"
                        style={{ color: '#555' }}>
                        {Math.round(p.fairnessScore)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['give', 'receive'] as const).map((side) => (
                      <div key={side}>
                        <p className="text-[9px] uppercase tracking-wider mb-1"
                          style={{ color: '#555' }}>
                          {side === 'give' ? 'You give' : 'You get'}
                        </p>
                        {p[side].map((pl) => (
                          <div key={pl.playerId}
                            className="flex items-center justify-between text-[10px] gap-1">
                            <span className="truncate"
                              style={{ color: '#e8e6df' }}>{pl.name}</span>
                            <span className="tabular-nums shrink-0"
                              style={{ color: side === 'receive' ? '#80ff49' : '#555' }}>
                              {pl.seasonPts.toFixed(0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] italic" style={{ color: '#555' }}>{p.summary}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
