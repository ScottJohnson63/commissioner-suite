'use client';

// src/components/cards/CardsLeftPanel.tsx
//
// What is left of the pool, and who is holding the rest.
//
// The "Cards left" tile is one number and nothing else — the pool size, the
// claimed count and the member count used to be crammed into a hint line under
// it that nobody could read at 8px on a phone. They are the answer to the
// question the tile prompts ("left out of what?"), so they live here, behind a
// tap, with room to be legible.
//
// Cards are owned exclusively, so "claimed" is not an abstraction: every card
// missing from the pool is in somebody's deck. That makes the per-member split
// the second half of the same answer rather than a separate leaderboard — it is
// the pool's remainder, itemised, biggest holder first.
//
// The rows are derived from the standings that the page already has in hand,
// not fetched: the leaderboard carries every eligible member with their card
// count, which is exactly this list under a different sort.

import type { LeaderboardEntryDto } from '@/types/cards';

export function CardsLeftPanel({
  remainingCards, poolSize, claimed, members, entries,
}: {
  /** Cards still unowned — the number the tile shows. */
  remainingCards: number;
  /** Cards in the pool in total. */
  poolSize: number;
  /** Cards already claimed by someone, league-wide. */
  claimed: number;
  /** Accounts sharing the pool. */
  members: number;
  /** The standings rows, in whatever order the page holds them. */
  entries: LeaderboardEntryDto[];
}) {
  // Sorted here rather than relying on the page's order: the standings arrive
  // ranked by season points, and this list is ranked by cards held. Name breaks
  // ties so a table of zeroes has a stable order instead of a random one.
  const holders = [...entries].sort(
    (a, b) => b.cards - a.cards || a.name.localeCompare(b.name),
  );
  const most = holders[0]?.cards ?? 0;
  const pct = poolSize ? Math.round((remainingCards / poolSize) * 100) : 0;

  return (
    <div>
      {/* ── The count, out of the pool it comes from ── */}
      <div className="text-center mb-1">
        <span className="text-3xl font-bold tabular-nums" style={{ color: '#80ff49' }}>
          {remainingCards.toLocaleString()}
        </span>
        <span className="text-sm tabular-nums ml-2" style={{ color: '#555' }}>
          of {poolSize.toLocaleString()} cards left
        </span>
      </div>

      <div className="text-center text-[10px] mb-4" style={{ color: '#444' }}>
        {claimed.toLocaleString()} claimed · {members.toLocaleString()}{' '}
        {members === 1 ? 'member' : 'members'} playing
      </div>

      {/* How much of the pool is still out there, at a glance. */}
      <div
        className="h-1.5 rounded overflow-hidden mb-6"
        style={{ background: '#1e1e20' }}
        role="presentation"
      >
        <div style={{ width: `${pct}%`, height: '100%', background: '#80ff49' }} />
      </div>

      {/* ── Who is holding the rest ── */}
      <div
        className="text-[10px] uppercase font-bold mb-2"
        style={{ letterSpacing: '0.16em', color: '#444' }}
      >
        Cards per player
      </div>

      {holders.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: '#555' }}>
          Nobody is in the league yet.
        </p>
      ) : (
        <ol className="rounded overflow-hidden" style={{ border: '1px solid #1e1e20' }}>
          {holders.map((entry, index) => (
            <li
              key={entry.userId}
              className="flex items-center gap-3 px-3 py-2"
              style={{
                background: entry.isYou ? 'rgba(128,255,73,0.06)' : '#141415',
                borderTop: index === 0 ? undefined : '1px solid #1e1e20',
              }}
            >
              <span
                className="text-xs font-bold tabular-nums shrink-0"
                style={{ width: 20, color: index === 0 && most > 0 ? '#80ff49' : '#555' }}
              >
                {index + 1}
              </span>

              <span
                className="text-xs truncate"
                style={{ color: entry.isYou ? '#80ff49' : '#e8e6df' }}
              >
                {entry.name}
                {entry.isYou && (
                  <span className="ml-1 text-[9px]" style={{ color: '#555' }}>you</span>
                )}
              </span>

              {/* Held cards, relative to the biggest deck in the league. */}
              <div
                className="flex-1 h-1 rounded overflow-hidden mx-1 min-w-[24px]"
                style={{ background: '#1e1e20' }}
              >
                <div
                  style={{
                    width: `${most ? Math.round((entry.cards / most) * 100) : 0}%`,
                    height: '100%',
                    background: entry.isYou ? '#80ff49' : '#3a3a44',
                  }}
                />
              </div>

              <span
                className="text-xs font-bold tabular-nums shrink-0 text-right"
                style={{ width: 44, color: '#e8e6df' }}
              >
                {entry.cards.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
