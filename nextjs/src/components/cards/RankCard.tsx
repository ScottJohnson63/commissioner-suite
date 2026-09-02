'use client';

// src/components/cards/RankCard.tsx
//
// Where the member stands, as a card in its own right.
//
// Everything else on the page is about cards you pulled. This is the one that
// is about you: your place in the league, what your lineup scores, and how far
// off the person above you is. Drawn in the same frame language as a player
// card so it reads as part of the set rather than as a widget.
//
// The gap to the next rank is the point of it. "3rd of 8" is a fact; "3rd, 4.2
// PPG off 2nd" is a reason to go and fill a slot.

import { TIER_STYLE } from '@/components/cards/tierStyles';
import { ROSTER_SIZE } from '@/lib/cards/roster';
import type { DeckStatsDto, LeaderboardEntryDto } from '@/types/cards';

/**
 * The frame a rank is drawn in.
 *
 * Reuses the tier palettes rather than inventing a fifth: first place gets the
 * Hall of Fame treatment, and it descends from there. A member climbing the
 * table sees their own card change metal, which is the same reward the packs
 * give.
 */
function frameForRank(rank: number | null, players: number) {
  if (rank === null) return TIER_STYLE.BRONZE;
  if (rank === 1) return TIER_STYLE.HALL_OF_FAME;
  if (rank <= Math.max(2, Math.ceil(players * 0.25))) return TIER_STYLE.GOLD;
  if (rank <= Math.ceil(players * 0.6)) return TIER_STYLE.SILVER;
  return TIER_STYLE.BRONZE;
}

/** 1st, 2nd, 3rd, 4th … */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function RankCard({
  stats, standings,
}: {
  stats: DeckStatsDto;
  standings: LeaderboardEntryDto[];
}) {
  const frame = frameForRank(stats.rank, stats.players);

  const me = standings.find((e) => e.isYou) ?? null;
  const ahead = me && me.rank > 1 ? standings[me.rank - 2] : null;
  const leader = standings[0] ?? null;

  const gapToNext = ahead && me ? Math.round((ahead.rosterPpg - me.rosterPpg) * 10) / 10 : null;

  return (
    <div
      className="relative rounded overflow-hidden"
      style={{
        padding: 1,
        background: frame.frame,
        boxShadow: `0 4px 20px -8px ${frame.glow}`,
      }}
    >
      <div className="relative p-4" style={{ borderRadius: 7, background: frame.ground }}>
        {frame.holo && (
          <div
            className="ut-holo absolute pointer-events-none"
            style={{
              top: 0, bottom: 0, width: '30%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
              animation: 'ut-holo 4.5s ease-in-out infinite',
            }}
          />
        )}

        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4">
          {/* ── The rank itself ── */}
          <div className="flex flex-col" style={{ lineHeight: 1 }}>
            <span
              className="text-[9px] uppercase font-bold mb-1.5"
              style={{ letterSpacing: '0.2em', color: frame.edge }}
            >
              Your rank
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-black"
                style={{ fontSize: 40, color: frame.ink, letterSpacing: '-0.04em' }}
              >
                {stats.rank === null ? '—' : ordinal(stats.rank)}
              </span>
              <span style={{ fontSize: 12, color: frame.ink, opacity: 0.6 }}>
                of {stats.players}
              </span>
            </div>
          </div>

          <Stat label="Lineup" value={stats.rosterPpg.toFixed(1)} unit="PPG" frame={frame} accent />
          <Stat label="Deck avg" value={stats.deckAvgPpg.toFixed(1)} unit="PPG" frame={frame} />
          <Stat label="Started" value={`${stats.started}/${ROSTER_SIZE}`} frame={frame} />
          <Stat label="Cards" value={String(stats.cards)} frame={frame} />
        </div>

        {/* ── The gap, which is the part that makes it a scoreboard ── */}
        <div
          className="relative mt-4 pt-3 text-[11px]"
          style={{ borderTop: `1px solid ${frame.edge}33`, color: frame.ink, opacity: 0.8 }}
        >
          {stats.rank === null ? (
            <>Fill your lineup to join the standings — nobody has scored yet.</>
          ) : gapToNext !== null && ahead ? (
            <>
              <strong style={{ color: frame.edge }}>{gapToNext.toFixed(1)} PPG</strong> behind{' '}
              {ahead.name} in {ordinal(ahead.rank)}.
            </>
          ) : leader && standings.length > 1 ? (
            <>
              Top of the league —{' '}
              <strong style={{ color: frame.edge }}>
                {(leader.rosterPpg - (standings[1]?.rosterPpg ?? 0)).toFixed(1)} PPG
              </strong>{' '}
              clear of {standings[1]?.name}.
            </>
          ) : (
            <>No one else has fielded a lineup yet.</>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, frame, accent,
}: {
  label: string; value: string; unit?: string;
  frame: ReturnType<typeof frameForRank>; accent?: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ lineHeight: 1 }}>
      <span
        className="text-[9px] uppercase font-bold mb-1.5"
        style={{ letterSpacing: '0.16em', color: frame.edge, opacity: 0.8 }}
      >
        {label}
      </span>
      <span className="font-bold" style={{ fontSize: 20, color: accent ? frame.edge : frame.ink }}>
        {value}
        {unit && (
          <span className="ml-1" style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
