'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { StandingEntry, StandingsResponse } from '@/types/standings';
import type { LotteryResult, DraftPick } from '@/types/lottery';

const LOTTERY_TOTAL       = 1_000_000;
const LOTTERY_DURATION_MS = 180_000;
const LOTTERY_INTERVAL_MS = 50;
const LOTTERY_BATCH       = Math.ceil(LOTTERY_TOTAL / (LOTTERY_DURATION_MS / LOTTERY_INTERVAL_MS));

const PICK_ACCENT  = ['#facc15', '#aaaaaa', '#cd7f32'] as const;
const PICK_LABEL   = ['1st Overall Pick', '2nd Overall Pick', '3rd Overall Pick'] as const;
const LIVE_ACCENTS = ['#80ff49', '#facc15', '#ff6d49'] as const;

function formatLotteryCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function LotteryTab({
  activeLeagueId,
  sleeperLeagueId,
  isCommissioner,
}: {
  activeLeagueId: string | null;
  sleeperLeagueId: string | null;
  isCommissioner: boolean;
}) {
  const effectiveId = activeLeagueId ?? sleeperLeagueId;
  const [standings, setStandings]       = useState<StandingEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [running, setRunning]           = useState(false);
  const [results, setResults]           = useState<LotteryResult[] | null>(null);
  const [totalDrawn, setTotalDrawn]     = useState(0);
  const [liveCounts, setLiveCounts]     = useState<number[]>([]);
  const [draftOrder, setDraftOrder]     = useState<DraftPick[] | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError]     = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rerunRef    = useRef(false);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const load = useCallback(async (leagueId: string) => {
    setLoading(true); setError(null); setResults(null);
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
    setStandings([]); setError(null); setResults(null);
    setRunning(false); setTotalDrawn(0); setLiveCounts([]);
    setDraftOrder(null); setDraftError(null);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (effectiveId) void load(effectiveId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeagueId, sleeperLeagueId, load]);

  useEffect(() => {
    if (!results || !effectiveId) return;
    void fetch('/api/assoc/lottery-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId: effectiveId, results, rerun: rerunRef.current }),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, activeLeagueId, sleeperLeagueId]);

  const worstTeams = useMemo(
    () => [...standings].sort((a, b) => b.rank - a.rank).slice(0, 3),
    [standings],
  );

  function runLottery() {
    if (worstTeams.length === 0) return;
    rerunRef.current = results !== null;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const n = worstTeams.length;
    const counts = new Array<number>(n).fill(0);
    let drawn = 0;
    setRunning(true); setResults(null); setTotalDrawn(0); setLiveCounts([...counts]);
    setDraftOrder(null); setDraftError(null);
    intervalRef.current = setInterval(() => {
      const thisBatch = Math.min(LOTTERY_BATCH, LOTTERY_TOTAL - drawn);
      for (let i = 0; i < thisBatch; i++) counts[Math.floor(Math.random() * n)]++;
      drawn += thisBatch;
      setTotalDrawn(drawn);
      setLiveCounts([...counts]);
      if (drawn >= LOTTERY_TOTAL) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        const sorted: LotteryResult[] = worstTeams
          .map((team, idx) => ({
            rosterId: team.rosterId, name: team.name, ownerName: team.ownerName,
            prevRank: team.rank, count: counts[idx], pick: 0,
          }))
          .sort((a, b) => b.count - a.count)
          .map((r, i) => ({ ...r, pick: i + 1 }));
        setResults(sorted);
        setRunning(false);
      }
    }, LOTTERY_INTERVAL_MS);
  }

  async function generateDraftOrder(): Promise<void> {
    if (!results || standings.length === 0 || !effectiveId) return;
    setDraftLoading(true); setDraftError(null);
    try {
      const lotteryRosterIds = new Set(results.map((r) => r.rosterId));
      const lotteryPicks: DraftPick[] = results.map((r) => ({
        pick: r.pick, rosterId: r.rosterId, name: r.name,
        ownerName: r.ownerName, source: 'lottery', prevRank: r.prevRank,
      }));
      const nonLotteryPicks: DraftPick[] = [...standings]
        .filter((s) => !lotteryRosterIds.has(s.rosterId))
        .sort((a, b) => b.rank - a.rank)
        .map((s, idx) => ({
          pick: lotteryPicks.length + idx + 1,
          rosterId: s.rosterId, name: s.name, ownerName: s.ownerName,
          source: 'standings', prevRank: s.rank,
        }));
      const order = [...lotteryPicks, ...nonLotteryPicks];
      setDraftOrder(order);
      await fetch('/api/assoc/draft-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: effectiveId, draftOrder: order }),
      });
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Failed to generate draft order');
    } finally { setDraftLoading(false); }
  }

  const progressPct = (totalDrawn / LOTTERY_TOTAL) * 100;
  const drawsPerMs  = LOTTERY_BATCH / LOTTERY_INTERVAL_MS;
  const msRemaining = running ? (LOTTERY_TOTAL - totalDrawn) / drawsPerMs : 0;

  const liveTeams = useMemo(
    () => worstTeams.map((team, idx) => ({ ...team, count: liveCounts[idx] ?? 0 })),
    [worstTeams, liveCounts],
  );
  const liveRankOf = useMemo(() => {
    const sorted = [...liveTeams].sort((a, b) => b.count - a.count);
    return new Map(sorted.map((t, i) => [t.rosterId, i]));
  }, [liveTeams]);

  return (
    <div className="max-w-xl">
      {error && (
        <div className="mb-4 px-3 py-2 rounded text-xs border"
          style={{ background: 'rgba(255,73,73,0.08)', color: '#ff4949', borderColor: 'rgba(255,73,73,0.2)' }}>
          {error}
        </div>
      )}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded animate-pulse"
              style={{ background: '#141415', border: '1px solid #1e1e20' }} />
          ))}
        </div>
      )}
      {!effectiveId && !loading && (
        <p className="text-xs text-center py-16" style={{ color: '#444' }}>
          Select a league to get started.
        </p>
      )}
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
          {isCommissioner && (
            <button
              onClick={runLottery}
              className="px-6 py-2.5 rounded text-sm font-medium transition-colors"
              style={{ background: '#80ff49', color: '#0e0e0f' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
            >
              Run Draft Lottery
            </button>
          )}
        </>
      )}

      {running && (
        <div>
          <div className="mb-7">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest" style={{ color: '#80ff49' }}>Drawing…</p>
              <span className="text-[10px] tabular-nums" style={{ color: '#555' }}>
                ~{formatLotteryCountdown(msRemaining)} remaining
              </span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#1e1e20' }}>
              <div className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #80ff49 0%, #c849ff 100%)',
                  transition: 'width 0.05s linear',
                }} />
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
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#444' }}>Live Race</p>
          <div className="rounded-lg p-4 flex flex-col gap-4"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            {liveTeams.map((team) => {
              const rank   = liveRankOf.get(team.rosterId) ?? 0;
              const accent = rank === 0 ? LIVE_ACCENTS[0] : '#555';
              const barPct = Math.min(100, (team.count / LOTTERY_TOTAL) * 100 * worstTeams.length);
              const pct    = totalDrawn > 0 ? ((team.count / totalDrawn) * 100).toFixed(2) : '0.00';
              return (
                <div key={team.rosterId}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-bold shrink-0 w-4 text-center"
                        style={{ color: accent, transition: 'color 0.3s' }}>{rank + 1}</span>
                      <span className="text-xs truncate" style={{ color: '#e8e6df' }}>
                        {team.name}
                        {team.ownerName && (
                          <span className="ml-1 text-[10px]" style={{ color: '#555' }}>({team.ownerName})</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs tabular-nums font-semibold"
                        style={{ color: accent, transition: 'color 0.3s' }}>
                        {team.count.toLocaleString()}
                      </span>
                      <span className="text-[10px] tabular-nums w-10 text-right" style={{ color: '#444' }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-9 rounded-md ml-6"
                    style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}>
                    <div className="absolute inset-y-0 left-0 rounded-l-md"
                      style={{ width: `${barPct}%`, background: accent, opacity: 0.25, transition: 'width 0.05s linear' }} />
                    <div className="absolute inset-x-0 h-px"
                      style={{ top: '50%', transform: 'translateY(-50%)', background: '#1a1a1c' }} />
                    <span className="absolute right-2 text-sm select-none leading-none"
                      style={{ top: '50%', transform: 'translateY(-50%)' }}>🏁</span>
                    <span
                      className="absolute text-xl select-none leading-none"
                      style={{
                        left: `clamp(4px, calc(${barPct}% - 14px), calc(100% - 34px))`,
                        top: '50%',
                        transform: 'translateY(-50%) scaleX(-1)',
                        transition: 'left 0.05s linear',
                        filter: rank === 0 ? 'drop-shadow(0 0 4px #facc15)' : undefined,
                      }}
                    >🏃</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results && !running && (
        <>
          <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#555' }}>
            Lottery Results · {LOTTERY_TOTAL.toLocaleString()} draws
          </p>
          <div className="flex flex-col gap-2 mb-6">
            {results.map((r) => {
              const accent = PICK_ACCENT[r.pick - 1];
              const label  = PICK_LABEL[r.pick - 1];
              const pct    = ((r.count / LOTTERY_TOTAL) * 100).toFixed(2);
              return (
                <div key={r.rosterId} className="rounded-lg px-4 py-3.5 flex items-center gap-4"
                  style={{ background: '#141415', border: `1px solid ${r.pick === 1 ? `${accent}44` : '#1e1e20'}` }}>
                  <span className="text-xl font-bold tabular-nums shrink-0 w-6 text-center"
                    style={{ color: accent }}>{r.pick}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#e8e6df' }}>
                      {r.name}
                      {r.ownerName && (
                        <span className="ml-1 text-xs font-normal" style={{ color: '#555' }}>({r.ownerName})</span>
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

          <div className="rounded-lg px-4 py-4 mb-6"
            style={{ background: '#141415', border: '1px solid #1e1e20' }}>
            <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: '#444' }}>Final Race</p>
            <div className="flex flex-col gap-4">
              {results.map((r) => {
                const accent  = r.pick === 1 ? PICK_ACCENT[0] : '#555';
                const barPct  = Math.min(100, (r.count / LOTTERY_TOTAL) * 100 * results.length);
                const pct     = (r.count / LOTTERY_TOTAL) * 100;
                return (
                  <div key={r.rosterId}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold shrink-0 w-4 text-center"
                          style={{ color: accent }}>{r.pick}</span>
                        <span className="text-xs truncate" style={{ color: '#e8e6df' }}>{r.name}</span>
                      </div>
                      <span className="text-[10px] tabular-nums shrink-0"
                        style={{ color: '#555' }}>{pct.toFixed(2)}%</span>
                    </div>
                    <div className="relative h-9 rounded-md ml-6"
                      style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}>
                      <div className="absolute inset-y-0 left-0 rounded-l-md"
                        style={{ width: `${barPct}%`, background: accent, opacity: 0.25 }} />
                      <div className="absolute inset-x-0 h-px"
                        style={{ top: '50%', transform: 'translateY(-50%)', background: '#1a1a1c' }} />
                      <span className="absolute right-2 text-sm select-none leading-none"
                        style={{ top: '50%', transform: 'translateY(-50%)' }}>🏁</span>
                      <span
                        className="absolute text-xl select-none leading-none"
                        style={{
                          left: `clamp(4px, calc(${barPct}% - 14px), calc(100% - 34px))`,
                          top: '50%',
                          transform: 'translateY(-50%) scaleX(-1)',
                          filter: r.pick === 1 ? 'drop-shadow(0 0 6px #facc15)' : undefined,
                        }}
                      >🏃</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isCommissioner && (
            <div className="flex flex-wrap gap-2">
              <button onClick={runLottery}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{ background: '#80ff49', color: '#0e0e0f' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}>
                ↻ Re-run Lottery
              </button>
              <button
                onClick={() => void generateDraftOrder()}
                disabled={draftLoading}
                className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40"
                style={{ background: '#facc15', color: '#0e0e0f' }}
                onMouseEnter={(e) => { if (!draftLoading) e.currentTarget.style.background = '#fcd93a'; }}
                onMouseLeave={(e) => { if (!draftLoading) e.currentTarget.style.background = '#facc15'; }}
              >
                {draftLoading ? 'Generating…' : draftOrder ? '↻ Regenerate Draft Order' : '+ Generate Draft Order'}
              </button>
              <button
                onClick={() => {
                  setResults(null); setTotalDrawn(0); setLiveCounts([]);
                  setDraftOrder(null); setDraftError(null);
                }}
                className="px-4 py-2 rounded text-sm font-medium border transition-colors"
                style={{ borderColor: '#2a2a2c', color: '#888' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}>
                Reset
              </button>
            </div>
          )}
          {draftError && (
            <p className="mt-2 text-xs" style={{ color: '#ff4949' }}>{draftError}</p>
          )}
          {draftOrder && (
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#facc15' }}>
                Draft Order · {new Date().getFullYear()} Season
              </p>
              <div className="rounded-lg overflow-hidden"
                style={{ background: '#141415', border: '1px solid #1e1e20' }}>
                {draftOrder.map((pick) => {
                  const isLottery  = pick.source === 'lottery';
                  const pickAccent = pick.pick <= 3 ? PICK_ACCENT[pick.pick - 1] : '#e8e6df';
                  return (
                    <div key={pick.rosterId}
                      className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
                      style={{ borderColor: '#1a1a1c' }}>
                      <span className="text-sm font-bold tabular-nums w-6 text-center shrink-0"
                        style={{ color: pickAccent }}>
                        {pick.pick}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                          {pick.name}
                          {pick.ownerName && (
                            <span className="ml-1 font-normal" style={{ color: '#555' }}>
                              ({pick.ownerName})
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: '#444' }}>
                          {isLottery ? `Lottery · prev rank #${pick.prevRank}` : `Prev rank #${pick.prevRank}`}
                        </p>
                      </div>
                      {isLottery && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium"
                          style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15' }}>
                          Lottery
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
