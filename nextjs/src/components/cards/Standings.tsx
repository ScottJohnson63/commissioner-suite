'use client';

// src/components/cards/Standings.tsx
//
// Who is winning the season.
//
// Ranked by **points banked** — the sum of every weekly lineup that has been
// published. That is the game's win condition stated exactly: each week's
// lineup adds to a running total, and the highest total at the end of the
// season takes it.
//
// The lineup a member is building right now is carried beside it as the first
// tiebreak rather than as the ranking figure. It is the best available guess at
// who is about to bank more, and before the season's first Tuesday it is the
// only thing there is to sort on — which is what the table used to rank on
// outright. Deck average breaks ties below that.
//
// Members who have not opened anything appear on zero rather than being hidden,
// so a league of eight always shows eight rows.
//
// Slots filled and deck average used to have columns here and no longer do.
// Four numeric columns on a phone is a row nobody reads; both are still on the
// page — slots on the lineup panel right above this, deck average on the rank
// card — and neither is what the season is decided by.

import { TIER_STYLE } from '@/components/cards/tierStyles';
import { TIER_LABEL, TIER_ORDER } from '@/lib/cards/tiers';
import type { LeaderboardEntryDto } from '@/types/cards';

export function Standings({ entries }: { entries: LeaderboardEntryDto[] }) {
  if (!entries.length) return null;

  const leader = entries[0]?.seasonPoints ?? 0;
  // Nobody has banked anything yet, so the bars would all be empty and the
  // column would be a row of zeroes. Fall back to what the table is actually
  // sorted by in that case — the lineups being built.
  const preseason = leader === 0;
  const scale = preseason ? entries[0]?.rosterPpg ?? 0 : leader;

  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid #1e1e20' }}>
      <div
        className="flex items-center gap-3 px-3 py-2"
        style={{ background: '#0e0e0f', borderBottom: '1px solid #1e1e20' }}
      >
        <span
          className="text-[10px] uppercase font-bold"
          style={{ letterSpacing: '0.16em', color: '#444' }}
        >
          Standings
        </span>
        <span className="text-[10px] ml-auto" style={{ color: '#444' }}>
          {preseason ? 'No weeks played yet — ranked by lineup' : 'Ranked by season points'}
        </span>
      </div>

      <div>
        {entries.map((entry) => (
          <div
            key={entry.userId}
            className="flex items-center gap-3 px-3 py-2.5"
            style={{
              background: entry.isYou ? 'rgba(128,255,73,0.06)' : '#141415',
              borderTop: '1px solid #1e1e20',
            }}
          >
            <span
              className="text-xs font-bold tabular-nums shrink-0"
              style={{ width: 20, color: entry.rank === 1 ? '#80ff49' : '#555' }}
            >
              {entry.rank}
            </span>

            <span
              className="text-xs truncate shrink-0"
              style={{ width: 110, color: entry.isYou ? '#80ff49' : '#e8e6df' }}
            >
              {entry.name}
              {entry.isYou && (
                <span className="ml-1 text-[9px]" style={{ color: '#555' }}>you</span>
              )}
            </span>

            {/* Tier breakdown — the shape of the deck, not just its size. */}
            <div className="flex items-center gap-2 shrink-0">
              {TIER_ORDER.map((tier) => (
                <span
                  key={tier}
                  title={TIER_LABEL[tier]}
                  className="text-[10px] tabular-nums"
                  style={{
                    color: entry.byTier[tier] ? TIER_STYLE[tier].edge : '#2a2a2c',
                    minWidth: 16,
                  }}
                >
                  {entry.byTier[tier]}
                </span>
              ))}
            </div>

            {/* Score bar, relative to the leader. */}
            <div className="flex-1 h-1 rounded overflow-hidden mx-1" style={{ background: '#1e1e20' }}>
              <div
                style={{
                  width: `${
                    scale
                      ? Math.round(
                          ((preseason ? entry.rosterPpg : entry.seasonPoints) / scale) * 100,
                        )
                      : 0
                  }%`,
                  height: '100%',
                  background: entry.isYou ? '#80ff49' : '#3a3a44',
                }}
              />
            </div>

            {/* Season points — what the row is ranked on. */}
            <span
              className="text-xs font-bold tabular-nums shrink-0 text-right"
              style={{ width: 52, color: '#e8e6df' }}
              title={`${entry.seasonPoints} points over ${entry.weeksPlayed} week(s)`}
            >
              {entry.seasonPoints.toFixed(1)}
            </span>
            {/* Weeks played, so a big total from a longer run is legible. */}
            <span
              className="text-[10px] tabular-nums shrink-0 text-right"
              style={{ width: 24, color: '#444' }}
              title={`${entry.weeksPlayed} week(s) played`}
            >
              {entry.weeksPlayed}w
            </span>
            {/* This week's lineup — the first tiebreak, and the live guess. */}
            <span
              className="text-[10px] tabular-nums shrink-0 text-right"
              style={{ width: 40, color: '#444' }}
              title="Points per game of the lineup they are building now"
            >
              {entry.rosterPpg.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
