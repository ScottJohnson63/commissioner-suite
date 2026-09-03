'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import type { PositionNeed, StatWindow, WaiverSuggestionsResponse } from '@/types/suggestions';
import { SLEEPER_THUMB, PANEL_BG, PanelActionBtn, PanelSkeleton, NoLeague, StatsSeasonNote } from './shared';
import { ContextTooltip } from './ContextTooltip';

// Two-stage image loader: DB headshot (NFL CDN) → Sleeper CDN → letter avatar.
// Each stage only fires if the previous one returned an error or was unavailable.
function WaiverAvatar({ playerId, headshot, name }: {
  playerId: string;
  headshot: string | null;
  name: string;
}) {
  // Start with DB headshot when available, fall back to Sleeper CDN immediately if not.
  const [src, setSrc]       = useState<string>(headshot ?? SLEEPER_THUMB(playerId));
  const [showLetter, setShowLetter] = useState(false);

  if (showLetter) {
    return (
      <div className="rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
        style={{ width: 30, height: 30, background: '#1e1e20', color: '#555' }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={30}
      height={30}
      className="rounded-full object-cover shrink-0"
      style={{ width: 30, height: 30, background: '#1e1e20' }}
      onError={() => {
        if (headshot && src === headshot) {
          // DB URL failed → try Sleeper CDN
          setSrc(SLEEPER_THUMB(playerId));
        } else {
          // Sleeper CDN also failed (or was the first attempt) → show letter
          setShowLetter(true);
        }
      }}
    />
  );
}

/**
 * Names the weeks the averages below are drawn from.
 *
 * The panel used to say "last 3 wks" in a caption and nothing else, which is
 * true only while the stat season is the season being played. It reads the same
 * whether the window is the last three weeks of this year or the first two of
 * last, so it says which weeks, of which season, every time.
 */
function windowLabel(w: StatWindow): string {
  const weeks = w.startWeek === w.endWeek
    ? `wk ${w.endWeek}`
    : `wks ${w.startWeek}–${w.endWeek}`;
  return `${w.season} ${weeks}`;
}

/**
 * "last 3 wks", counted rather than asserted.
 *
 * The window is three weeks wide once three have been played and synced, and
 * narrower before that. A fixed caption would claim an average over weeks that
 * do not exist yet.
 */
function spanLabel(w: StatWindow): string {
  const weeks = w.endWeek - w.startWeek + 1;
  return weeks === 1 ? 'last wk' : `last ${weeks} wks`;
}

/** Positions listed as needs, worst first, whether or not any is past the bar. */
const NEEDS_SHOWN = 3;

/** Rows per page. Ten fits without scrolling and pages a hundred in ten steps. */
const PAGE_SIZE = 10;

/**
 * One position's standing, as a line a manager can argue with.
 *
 * The panel used to show a bare orange "QB" chip and nothing else, so a flag
 * that was wrong looked exactly like a flag that was right. Every number behind
 * the judgement is on the row now: what this roster's starters average, what the
 * league's do, where that ranks, and how many games any of it rests on.
 */
function NeedRow({ need }: { need: PositionNeed }) {
  const accent = need.unmeasured ? '#6b6b6b' : need.weak ? '#ff6d49' : '#888';
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px] tabular-nums">
      <span className="flex items-baseline gap-1.5 min-w-0">
        <span className="px-1.5 py-0.5 rounded font-medium shrink-0"
          style={{
            background: need.weak ? 'rgba(255,109,73,0.12)' : '#1a1a1c',
            color: accent,
          }}>
          {need.position}
        </span>
        <span style={{ color: '#555' }}>
          {need.rank} of {need.of}
        </span>
      </span>
      {need.unmeasured ? (
        // Not a claim about the roster. Saying "0.0 pts" here without saying why
        // is what sends someone to drop a starter over a sync gap.
        <span style={{ color: '#6b6b6b' }}
          title={`No games in the window for the ${need.slots > 1 ? `${need.slots} ${need.position}s` : need.position} this roster would start — nothing was measured, so this is not counted as a weakness.`}>
          no games in window
        </span>
      ) : (
        <span style={{ color: '#555' }}
          title={`Your top ${need.slots} ${need.position}${need.slots > 1 ? 's' : ''} averaged ${need.mine} pts/game over ${need.games} game${need.games === 1 ? '' : 's'}; the league median is ${need.median}.`}>
          <span style={{ color: accent }}>{need.mine.toFixed(1)}</span>
          <span style={{ color: '#333' }}> vs </span>
          {need.median.toFixed(1)} med
        </span>
      )}
    </div>
  );
}

export function WaiverSuggestionsPanel({
  leagueId, userId,
}: { leagueId: string | null; userId: string | null }) {
  const [data, setData]       = useState<WaiverSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [page, setPage]           = useState(0);

  // The list the rows are drawn from: every suggestion, or one position's.
  const shown = useMemo(
    () => (data?.suggestions ?? []).filter((s) => !posFilter || s.position === posFilter),
    [data, posFilter],
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // Clamped rather than reset: a filter that shortens the list should not throw
  // away the reader's place when the page they were on still exists.
  const safePage  = Math.min(page, pageCount - 1);
  const rows      = shown.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Positions actually present in the pool, in the order the server mixed them —
  // which is worst-need first, so the first chip is the biggest hole.
  const positions = useMemo(() => {
    const seen: string[] = [];
    for (const s of data?.suggestions ?? []) if (!seen.includes(s.position)) seen.push(s.position);
    return seen;
  }, [data]);

  async function run() {
    if (!leagueId || !userId) return;
    setLoading(true); setError(null);
    setPosFilter(null); setPage(0);
    try {
      const res = await fetch(
        // No season param: the server resolves it from NFL_SEASON (see resolveSeason).
        `/api/sleeper/waiver-suggestions?leagueId=${leagueId}&userId=${userId}`,
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
          <StatsSeasonNote season={data.statsSeason} fallback={data.statsFallback} />
          {/* ── Where this roster is thinnest ─────────────────────────────
              A ladder, not a flag. Every roster has a weakest position whether
              or not it is bad enough to act on, and showing only the ones past a
              threshold meant most weeks showed nothing and some weeks showed one
              chip with no way to tell whether to believe it. */}
          {(data.positionNeeds?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                Thinnest spots
                {data.weakPositions.length === 0 && (
                  <span style={{ color: '#333' }}> · none past the weakness bar</span>
                )}
              </span>
              {data.positionNeeds.slice(0, NEEDS_SHOWN).map((need) => (
                <NeedRow key={need.position} need={need} />
              ))}
            </div>
          )}

          {/* ── Column header ──────────────────────────────────────────────
              The two numbers on each row are different readings and were
              indistinguishable without it: the average is what the player did,
              the range is what he is projected to do next. */}
          {data.suggestions.length > 0 && (
            <div className="flex items-end justify-between gap-2 pb-1"
              style={{ borderBottom: '1px solid #1e1e20' }}>
              {/* Filter chips, in worst-need order. "All" is the mixed list the
                  server interleaves; a position chip drills into one. */}
              <div className="flex items-center gap-1 flex-wrap min-w-0">
                {[null, ...positions].map((pos) => (
                  <button
                    key={pos ?? 'all'}
                    type="button"
                    onClick={() => { setPosFilter(pos); setPage(0); }}
                    className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                    style={{
                      background: posFilter === pos ? 'rgba(128,255,73,0.12)' : '#1a1a1c',
                      color:      posFilter === pos ? '#80ff49' : '#666',
                    }}
                  >
                    {pos ?? 'All'}
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#80ff49' }}>
                  Avg · {spanLabel(data.window)}
                </span>
                <span className="text-[9px] tabular-nums" style={{ color: '#555' }}>
                  {windowLabel(data.window)} · low–high next wk
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col">
            {rows.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: '#444' }}>
                No suggestions available — check back after more games
              </p>
            ) : rows.map((s) => (
              <div key={s.playerId}
                className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
                style={{ borderColor: '#1a1a1c' }}>
                <WaiverAvatar playerId={s.playerId} headshot={s.headshot} name={s.name} />
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
                    {/* The same fixture/defense/weather/line card the matchup
                        report shows, from the same component. */}
                    <ContextTooltip
                      context={s.context}
                      position={s.position}
                      playerName={s.name}
                    />
                    {/* One game or none means the average is a single result and
                        the range is mostly the positional baseline — worth
                        seeing, since both numbers look the same either way. */}
                    {s.games <= 1 && (
                      <span
                        className="text-[9px] shrink-0"
                        style={{ color: '#6b6b6b' }}
                        title={s.games === 0
                          ? 'No games in these weeks — the range is projected from position alone'
                          : '1 game in these weeks — the average is that one result'}
                      >
                        {s.games}g
                      </span>
                    )}
                    {/* Sleeper's add count, back on the row and in the ranking.
                        Several thousand managers adding someone this week is
                        real news about a job the stat window has not caught. */}
                    {s.trendingCount !== null && s.trendingCount > 0 && (
                      <span
                        className="text-[9px] px-1 rounded shrink-0"
                        style={{ background: 'rgba(128,255,73,0.10)', color: '#5f9e42' }}
                        title={`${s.trendingCount.toLocaleString()} managers added this player across Sleeper in the last week`}
                      >
                        ▲{s.trendingCount >= 1000
                          ? `${Math.round(s.trendingCount / 100) / 10}k`
                          : s.trendingCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] truncate mt-0.5" style={{ color: '#555' }}>{s.reason}</p>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-xs font-semibold tabular-nums"
                    style={{ color: '#80ff49' }}
                    title={`${s.recentAvg.toFixed(1)} pts per game over ${windowLabel(data.window)} (${s.games} game${s.games === 1 ? '' : 's'})`}>
                    {s.recentAvg.toFixed(1)} pts
                  </span>
                  <span className="text-[10px] tabular-nums" style={{ color: '#6b6b6b' }}
                    title={`Projected range for next week: ${s.floor.toFixed(1)} to ${s.ceiling.toFixed(1)} (10th–90th percentile around ${s.projected.toFixed(1)})`}>
                    <span style={{ color: '#ff6d49' }}>↓{s.floor.toFixed(1)}</span>
                    <span style={{ color: '#2a2a2c' }}> · </span>
                    <span style={{ color: '#80ff49' }}>↑{s.ceiling.toFixed(1)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            {/* Eight rows out of how many. The panel used to rank the fifty names
                Sleeper's trending feed returned; saying what was actually
                searched is the difference between a shortlist and a top-of-the-
                popularity-list. */}
            <div className="flex items-center gap-2 min-w-0">
              {pageCount > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                    className="text-[10px] px-1.5 py-0.5 rounded disabled:opacity-30 transition-opacity"
                    style={{ background: '#1a1a1c', color: '#888' }}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <span className="text-[10px] tabular-nums" style={{ color: '#555' }}>
                    {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + rows.length} of {shown.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                    disabled={safePage >= pageCount - 1}
                    className="text-[10px] px-1.5 py-0.5 rounded disabled:opacity-30 transition-opacity"
                    style={{ background: '#1a1a1c', color: '#888' }}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              )}
              {data.scanned > 0 && (
                <span className="text-[10px] truncate" style={{ color: '#333' }}>
                  from {data.scanned.toLocaleString()} free agents
                </span>
              )}
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
          </div>
        </>
      )}
    </div>
  );
}
