'use client';

// src/components/cards/Standings.tsx
//
// Who is winning the season.
//
// Ranked by what a member's starting lineup scores per game, not by how many
// cards they own. Exclusive ownership means one member holding the 2025
// McCaffrey denies everyone else, but a pile of cards you cannot start is not a
// team — so the table ranks the ten you field, and carries deck average
// alongside as the answer to the other question.
//
// Members who have not opened anything appear on zero rather than being hidden,
// so a league of eight always shows eight rows.

import { TIER_STYLE } from '@/components/cards/tierStyles';
import { TIER_LABEL, TIER_ORDER } from '@/lib/cards/tiers';
import { ROSTER_SIZE } from '@/lib/cards/roster';
import type { LeaderboardEntryDto } from '@/types/cards';

export function Standings({ entries }: { entries: LeaderboardEntryDto[] }) {
  if (!entries.length) return null;

  const leader = entries[0]?.rosterPpg ?? 0;

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
          Ranked by lineup PPG
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
                  width: `${leader ? Math.round((entry.rosterPpg / leader) * 100) : 0}%`,
                  height: '100%',
                  background: entry.isYou ? '#80ff49' : '#3a3a44',
                }}
              />
            </div>

            {/* Lineup PPG — what the row is ranked on. */}
            <span
              className="text-xs font-bold tabular-nums shrink-0 text-right"
              style={{ width: 52, color: '#e8e6df' }}
              title="Lineup points per game"
            >
              {entry.rosterPpg.toFixed(1)}
            </span>
            {/* Slots filled, so a big number from a half-empty lineup is legible. */}
            <span
              className="text-[10px] tabular-nums shrink-0 text-right"
              style={{ width: 34, color: entry.started === ROSTER_SIZE ? '#444' : '#7a6a3a' }}
              title={`${entry.started} of ${ROSTER_SIZE} slots filled`}
            >
              {entry.started}/{ROSTER_SIZE}
            </span>
            {/* Deck average — the tiebreak, and the other question. */}
            <span
              className="text-[10px] tabular-nums shrink-0 text-right"
              style={{ width: 34, color: '#444' }}
              title="Average points per game across the whole deck"
            >
              {entry.deckAvgPpg.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
