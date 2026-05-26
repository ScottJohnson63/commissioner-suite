'use client';

import { useState } from 'react';
import type { WaiverSuggestionsResponse } from '@/types/suggestions';
import { SLEEPER_THUMB, PANEL_BG, PanelActionBtn, PanelSkeleton, NoLeague } from './shared';

export function WaiverSuggestionsPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<WaiverSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/sleeper/waiver-suggestions?leagueId=${leagueId}&userId=${userId}&season=2025`,
      );
      if (!res.ok) throw new Error('Failed to load suggestions');
      setData(await res.json() as WaiverSuggestionsResponse);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl p-5 flex flex-col gap-4" style={PANEL_BG}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">📋</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#e8e6df' }}>Waiver Wire</p>
          </div>
        </div>
        <PanelActionBtn onClick={() => void run()} disabled={!leagueId || !userId}
          loading={loading} label="Find Suggestions" loadingLabel="Loading…" />
      </div>

      {(!leagueId || !userId) && <NoLeague />}
      {error && <p className="text-xs" style={{ color: '#ff4949' }}>{error}</p>}
      {loading && <PanelSkeleton rows={4} height={40} />}

      {data && !loading && (
        <>
          {data.weakPositions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                Weak spots:
              </span>
              {data.weakPositions.map((pos) => (
                <span key={pos} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: 'rgba(255,109,73,0.12)', color: '#ff6d49' }}>
                  {pos}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col">
            {data.suggestions.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: '#444' }}>
                No suggestions available — check back after more games
              </p>
            ) : data.suggestions.map((s) => (
              <div key={s.playerId}
                className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
                style={{ borderColor: '#1a1a1c' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SLEEPER_THUMB(s.playerId)} alt={s.name}
                  width={30} height={30} className="rounded-full shrink-0 object-cover"
                  style={{ width: 30, height: 30, background: '#1e1e20' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                      {s.name}
                    </span>
                    <span className="text-[10px] px-1 rounded shrink-0"
                      style={{ background: '#1e1e20', color: '#555' }}>{s.position}</span>
                    {s.team && (
                      <span className="text-[10px] shrink-0" style={{ color: '#444' }}>{s.team}</span>
                    )}
                  </div>
                  <p className="text-[10px] truncate mt-0.5" style={{ color: '#555' }}>{s.reason}</p>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0"
                  style={{ color: '#80ff49' }}>
                  {s.recentAvg.toFixed(1)} pts
                </span>
              </div>
            ))}
          </div>
          {data.suggestions.some((s) => s.trendingCount !== null) && (
            <p className="text-[10px] text-right" style={{ color: '#333' }}>
              Add counts via{' '}
              <a
                href="https://sleeper.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#444' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#80ff49')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}
              >
                Sleeper
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
