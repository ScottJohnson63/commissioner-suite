'use client';

// src/components/cards/WeekResults.tsx
//
// Tuesday morning: what everybody played.
//
// The reveal is the payoff of the whole week, so it is laid out as two answers
// to two different questions rather than one table trying to be both.
//
// **Who won the week** is the standings strip at the top — every member's
// lineup total, best to worst.
//
// **Whose card was best** is the run of cards below it, every card anybody
// played in one list from best to worst, drawn as the cards themselves. That is
// where a nicknamed card with somebody's own photograph on it gets to be the
// best card of the week in front of the league, which is the reason the game
// has nicknames and photographs at all. Names and pictures come straight off
// PlayerCard, so a card looks the same here as it does in its owner's deck.
//
// Two variants, one panel. On the lineup tab it is a framed panel with the
// published weeks laid out as a row of buttons — there are at most eighteen,
// they are the navigation, and seeing how many weeks have been played is worth
// the width. Inside the Season dialog on the Packs tab that width does not
// exist and the dialog's own header already says what this is, so the frame
// comes off and the weeks collapse into a dropdown.

import { useState } from 'react';
import { PlayerCard } from '@/components/cards/PlayerCard';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import type { PlayedCardDto, WeekResultsDto } from '@/types/cards';

/** How many cards the list shows before it needs asking. */
const CARDS_SHOWN = 24;

export function WeekResults({
  results, week, onWeek, loading, variant = 'panel',
}: {
  results: WeekResultsDto | null;
  /** The week being shown, so the picker stays controlled by the page. */
  week: number | null;
  onWeek: (week: number) => void;
  loading: boolean;
  /** `dialog` drops the frame and picks weeks from a dropdown — see the note above. */
  variant?: 'panel' | 'dialog';
}) {
  const [showAll, setShowAll] = useState(false);

  const inDialog = variant === 'dialog';
  const weeks = results?.weeks ?? [];
  const cards = results?.cards ?? [];
  const shown = showAll ? cards : cards.slice(0, CARDS_SHOWN);

  return (
    <div
      className="rounded overflow-hidden"
      style={{ border: inDialog ? 'none' : '1px solid #1e1e20' }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2"
        style={{ background: '#0e0e0f', borderBottom: '1px solid #1e1e20' }}
      >
        <span
          className="text-[10px] uppercase font-bold"
          style={{ letterSpacing: '0.16em', color: '#444' }}
        >
          {inDialog ? 'Week' : 'Results'}
        </span>

        {inDialog ? (
          /* A dialog is as wide as a phone and no wider, and the weeks are a
             filter here rather than the panel's navigation — so one control
             that costs a line beats a row that grows one every week. Newest
             first: the week a member came to read is the top option. */
          weeks.length > 0 && (
            <select
              aria-label="Week"
              value={week ?? ''}
              onChange={(e) => onWeek(Number(e.target.value))}
              className="text-[11px] rounded px-2 py-1 ml-auto tabular-nums"
              style={{ background: '#141415', border: '1px solid #2a2a2c', color: '#e8e6df' }}
            >
              {/* Nothing is selected while the first read is in flight, and a
                  value with no matching option is an uncontrolled select. */}
              {week === null && <option value="">Loading…</option>}
              {[...weeks].reverse().map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          )
        ) : (
          /* One button per published week. There are at most eighteen and they
             are the navigation, so a row of them beats a dropdown — a member can
             see how many weeks have been played without opening anything. */
          <div className="flex flex-wrap gap-1 ml-auto">
            {weeks.map((w) => (
              <button
                key={w}
                onClick={() => onWeek(w)}
                className="text-[10px] px-1.5 py-0.5 rounded tabular-nums transition-colors"
                style={{
                  color: w === week ? '#80ff49' : '#666',
                  background: w === week ? 'rgba(128,255,73,0.08)' : 'transparent',
                  border: `1px solid ${w === week ? '#80ff4955' : '#1e1e20'}`,
                }}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-xs px-3 py-8 text-center" style={{ color: '#555' }}>Loading…</p>
      ) : !results || !results.entries.length ? (
        <p className="text-xs px-3 py-8 text-center" style={{ color: '#555' }}>
          {weeks.length === 0
            ? 'No results yet — the first week is published on Tuesday at 10am central.'
            : `Nobody submitted a lineup in week ${week}.`}
        </p>
      ) : (
        <>
          {/* ── Who won the week ── */}
          <div>
            {results.entries.map((entry) => (
              <div
                key={entry.userId}
                className="flex items-center gap-3 px-3 py-2"
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
                  className="text-xs truncate"
                  style={{ color: entry.isYou ? '#80ff49' : '#e8e6df' }}
                >
                  {entry.name}
                  {entry.isYou && (
                    <span className="ml-1 text-[9px]" style={{ color: '#555' }}>you</span>
                  )}
                </span>
                <span
                  className="text-[10px] tabular-nums ml-auto shrink-0"
                  style={{ color: '#444' }}
                  title={`${entry.filled} cards played`}
                >
                  {entry.filled} cards
                </span>
                <span
                  className="text-xs font-bold tabular-nums shrink-0 text-right"
                  style={{ width: 56, color: '#e8e6df' }}
                >
                  {entry.points.toFixed(1)}
                </span>
              </div>
            ))}
          </div>

          {/* ── Whose card was best ── */}
          <div className="px-3 py-3" style={{ background: '#0a0a0b', borderTop: '1px solid #1e1e20' }}>
            <div className="flex items-baseline gap-3 mb-3">
              <span
                className="text-[10px] uppercase font-bold"
                style={{ letterSpacing: '0.16em', color: '#444' }}
              >
                Cards played
              </span>
              <span className="text-[10px]" style={{ color: '#555' }}>
                best to worst
              </span>
              {cards.length > CARDS_SHOWN && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[10px] ml-auto underline"
                  style={{ color: '#666' }}
                >
                  {showAll ? 'Show top 24' : `Show all ${cards.length}`}
                </button>
              )}
            </div>

            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
            >
              {shown.map((card, index) => (
                <PlayedCard key={`${card.ownerId}-${card.id}`} card={card} place={index + 1} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One card as it was played: the card itself, what it scored, and whose it is.
 *
 * The owner's name sits under the card rather than on it. A card face belongs
 * to the player on it — that is the whole conceit — and stamping an account
 * name across it would make the reveal a list of people rather than a list of
 * cards.
 */
function PlayedCard({ card, place }: { card: PlayedCardDto; place: number }) {
  const tier = TIER_STYLE[card.tier];

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <PlayerCard card={card} width={104} />
        {/* Only the podium is numbered. Every card carrying a rank badge turns
            a wall of cards into a wall of numbers. */}
        {place <= 3 && (
          <span
            className="absolute font-bold"
            style={{
              top: -4, left: -4, fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: '#0a0a0b', color: tier.edge, border: `1px solid ${tier.edge}`,
            }}
          >
            {place}
          </span>
        )}
      </div>
      <span className="text-[11px] font-bold mt-1.5 tabular-nums" style={{ color: '#e8e6df' }}>
        {card.points.toFixed(1)}
      </span>
      <span
        className="text-[10px] truncate max-w-full"
        style={{ color: card.isYou ? '#80ff49' : '#555' }}
        title={card.ownerName}
      >
        {card.ownerName}
      </span>
    </div>
  );
}
