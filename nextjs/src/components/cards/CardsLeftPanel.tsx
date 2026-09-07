'use client';

// src/components/cards/CardsLeftPanel.tsx
//
// What is left in the pool, and who took the rest.
//
// Cards are owned exclusively, so "cards left" is the game's clock: every pack
// opened takes cards out of a pool nobody refills until a commissioner
// backfills another season. The tile on the Packs page reports the number; this
// is what the number is made of — how much of the pool has gone, and into whose
// deck.
//
// The per-member counts come off the standings the collection read already
// computes, rather than a second endpoint: ranking a member means counting
// everybody's cards, so the numbers are already in hand and cannot drift from
// the deck they were read with.

import type { AllowanceDto, LeaderboardEntryDto } from '@/types/cards';

export function CardsLeftPanel({
  allowance, standings,
}: {
  allowance: AllowanceDto;
  /** Every eligible member, including anyone who has not opened a pack. */
  standings: LeaderboardEntryDto[];
}) {
  const { remainingCards, poolSize, claimed } = allowance;
  // Guarded because an empty pool is a real state — a league whose commissioner
  // has not built the cards yet — and 0/0 is a divide, not a bar at 100%.
  const claimedPct = poolSize > 0 ? Math.round((claimed / poolSize) * 100) : 0;

  // Most to least, then by name so a league where nobody has opened anything
  // is in a stable order rather than the standings' points order.
  const owners = [...standings].sort(
    (a, b) => b.cards - a.cards || a.name.localeCompare(b.name),
  );
  // The widest deck sets the bar's full width, so the rows compare with each
  // other rather than with a pool that dwarfs all of them.
  const widest = owners[0]?.cards ?? 0;

  return (
    <div>
      {/* ── The pool ──
          The count first and at size, because it is the number the tile was
          tapped from; the total under it, because "1,204" only means something
          against what it started as. */}
      <div className="rounded p-4 mb-5 text-center" style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}>
        <div className="text-3xl font-bold" style={{ color: '#80ff49' }}>
          {remainingCards.toLocaleString()}
        </div>
        <div className="text-xs mt-1" style={{ color: '#888' }}>
          of {poolSize.toLocaleString()} cards still unclaimed
        </div>

        <div className="mt-3 h-1.5 rounded overflow-hidden" style={{ background: '#1e1e20' }}>
          <div
            className="h-full"
            style={{ width: `${claimedPct}%`, background: '#80ff49', opacity: 0.75 }}
          />
        </div>
        <div className="text-[10px] mt-1.5 uppercase" style={{ letterSpacing: '0.1em', color: '#444' }}>
          {claimed.toLocaleString()} claimed · {claimedPct}% of the pool
        </div>
      </div>

      {/* ── Where they went ── */}
      <div className="text-[10px] uppercase mb-2" style={{ letterSpacing: '0.12em', color: '#444' }}>
        Cards per player
      </div>

      {owners.length === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: '#555' }}>
          Nobody is playing yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {owners.map((entry) => (
            <li
              key={entry.userId}
              className="flex items-center gap-3 rounded px-3 py-2"
              style={{
                background: entry.isYou ? 'rgba(128,255,73,0.07)' : '#0e0e0f',
                border: `1px solid ${entry.isYou ? 'rgba(128,255,73,0.28)' : '#1e1e20'}`,
              }}
            >
              <span
                className="text-xs truncate flex-1 min-w-0"
                style={{ color: entry.isYou ? '#80ff49' : '#e8e6df' }}
              >
                {entry.name}
              </span>

              {/* A bar beside the figure rather than instead of it: the count is
                  what was asked for, the bar is what makes a list of a dozen
                  numbers readable at a glance. Hidden on the narrowest phones,
                  where the name deserves the room. */}
              <span
                aria-hidden
                className="hidden sm:block h-1.5 rounded w-24 shrink-0"
                style={{ background: '#1e1e20' }}
              >
                <span
                  className="block h-full rounded"
                  style={{
                    width: widest > 0 ? `${(entry.cards / widest) * 100}%` : '0%',
                    background: entry.isYou ? '#80ff49' : '#3a3a3a',
                  }}
                />
              </span>

              <span
                className="text-xs font-bold tabular-nums shrink-0 text-right"
                style={{ width: 44, color: entry.isYou ? '#80ff49' : '#e8e6df' }}
              >
                {entry.cards.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
