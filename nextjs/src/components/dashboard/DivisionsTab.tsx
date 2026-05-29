'use client';

import { useState, useCallback, useEffect } from 'react';
import type { StandingEntry, StandingsResponse } from '@/types/standings';

export function DivisionsTab({
  activeLeagueId,
  sleeperLeagueId,
  isCommissioner,
}: {
  activeLeagueId: string | null;
  sleeperLeagueId: string | null;
  isCommissioner: boolean;
}) {
  const effectiveId = activeLeagueId ?? sleeperLeagueId;
  const [standings, setStandings]         = useState<StandingEntry[]>([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [generating, setGenerating]       = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateOk, setGenerateOk]       = useState(false);

  const load = useCallback(async (leagueId: string) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/assoc/standings?leagueId=${encodeURIComponent(leagueId)}`);
      const data = await res.json() as StandingsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load standings');
      setStandings(data.standings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load standings');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandings([]); setError(null); setGenerateError(null); setGenerateOk(false);
    if (effectiveId) void load(effectiveId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeagueId, sleeperLeagueId, load]);

  const generateDivisions = useCallback(async () => {
    if (!effectiveId || standings.length === 0) return;
    setGenerating(true); setGenerateError(null); setGenerateOk(false);
    try {
      const res = await fetch('/api/assoc/divisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: effectiveId, standings }),
      });
      const data = await res.json() as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate divisions');
      setGenerateOk(true);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Failed to generate divisions');
    } finally { setGenerating(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeagueId, sleeperLeagueId, standings]);

  const div1 = standings.filter((s) => s.division === 1);
  const div2 = standings.filter((s) => s.division === 2);
  const DIV_COLORS: Record<1 | 2, string> = { 1: '#c849ff', 2: '#ff6d49' };

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-4 px-3 py-2 rounded text-xs border"
          style={{ background: 'rgba(255,73,73,0.08)', color: '#ff4949', borderColor: 'rgba(255,73,73,0.2)' }}>
          {error}
        </div>
      )}
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
      {!loading && standings.length === 0 && !error && (
        <p className="text-xs text-center py-16" style={{ color: '#444' }}>
          {effectiveId ? 'No standings data found for this league.' : 'Select a league to get started.'}
        </p>
      )}
      {!loading && standings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([1, 2] as const).map((divId) => {
            const teams  = divId === 1 ? div1 : div2;
            const accent = DIV_COLORS[divId];
            return (
              <div key={divId} className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e20', background: '#141415' }}>
                <div className="px-4 py-3 border-b flex items-center gap-2"
                  style={{ borderColor: '#1e1e20' }}>
                  <p className="text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: accent }}>Division {divId}</p>
                  <span className="text-[10px]" style={{ color: '#444' }}>
                    {teams.length} teams · {divId === 1 ? 'odd ranks' : 'even ranks'}
                  </span>
                </div>
                <div>
                  {teams.map((team) => (
                    <div key={team.rosterId}
                      className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0"
                      style={{ borderColor: '#1a1a1c' }}>
                      <span className="w-5 text-right text-[11px] tabular-nums shrink-0" style={{ color: '#444' }}>
                        {team.rank}
                      </span>
                      {team.isChampion ? (
                        <span className="shrink-0 text-sm" title="Champion">♛</span>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
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
      {!loading && standings.length > 0 && (
        <p className="mt-4 text-[10px]" style={{ color: '#444' }}>
          ♛ Champion · Rankings from final bracket results
        </p>
      )}
      {!loading && standings.length > 0 && isCommissioner && (
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => void generateDivisions()}
            disabled={generating}
            className="px-5 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: '#c849ff', color: '#fff' }}
            onMouseEnter={(e) => { if (!generating) e.currentTarget.style.background = '#d966ff'; }}
            onMouseLeave={(e) => { if (!generating) e.currentTarget.style.background = '#c849ff'; }}
          >
            {generating ? 'Saving…' : 'Generate Divisions'}
          </button>
          {generateOk && (
            <span className="text-xs" style={{ color: '#80ff49' }}>Divisions saved.</span>
          )}
          {generateError && (
            <span className="text-xs" style={{ color: '#ff4949' }}>{generateError}</span>
          )}
        </div>
      )}
    </div>
  );
}
