'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { StatWindow, WaiverSuggestionsResponse } from '@/types/suggestions';
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
          {data.weakPositions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                Weak spots:
              </span>
              {data.weakPositions.map((pos) => (
                <span key={pos} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: 'rgba(255,109,73,0.12)', color: '#ff6d49' }}
                  // What "weak" measured, in the terms the league actually plays
                  // in: the slots it starts, over the weeks named below.
                  title={`Your top ${data.starterSlots?.[pos] ?? 1} ${pos}${(data.starterSlots?.[pos] ?? 1) > 1 ? 's' : ''} averaged more than 15% below the league median over ${windowLabel(data.window)}`}>
                  {pos}
                </span>
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
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#555' }}>
                Player
              </span>
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
            {data.suggestions.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: '#444' }}>
                No suggestions available — check back after more games
              </p>
            ) : data.suggestions.map((s) => (
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
