'use client';

// src/components/cards/DeckGrid.tsx
//
// A member's deck, and how strong it is.
//
// This deliberately does not show completion. Ownership is exclusive — nobody
// can ever hold the full 1,832 — so "45 of 1,832" would be a progress bar
// towards something unreachable, and would make a good deck look like a failure.
// What matters instead is rarity: how many of the scarce cards you got before
// anybody else did, expressed as a score and a count per tier.

import { useMemo, useState } from 'react';
import { PlayerCard } from '@/components/cards/PlayerCard';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import { DECK_POINTS, TIER_LABEL, TIER_ORDER } from '@/lib/cards/tiers';
import type { CardTier, DeckStatsDto, OwnedCardDto } from '@/types/cards';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export function DeckGrid({
  cards, stats, seasons, afterTiers, selectedId, onSelect,
}: {
  cards: OwnedCardDto[];
  stats: DeckStatsDto;
  seasons: number[];
  /** The card open in the detail panel above, so the grid can mark it. */
  selectedId?: string | null;
  /**
   * Picks a card. When given, every tile becomes a button — the grid stops
   * being a display and becomes the picker for the panel above it.
   */
  onSelect?: (card: OwnedCardDto) => void;
  /**
   * Rendered between the tier tiles and the filters.
   *
   * A slot rather than the caller composing these itself, because the tiles are
   * not just a summary — they are the tier filter, wired to this component's
   * own state. Hoisting them out to reorder the page would mean lifting that
   * state with them and handing it back down.
   */
  afterTiers?: React.ReactNode;
}) {
  const [tier, setTier] = useState<CardTier | 'ALL'>('ALL');
  const [position, setPosition] = useState<string>('ALL');
  const [season, setSeason] = useState<number | 'ALL'>('ALL');

  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (tier === 'ALL' || c.tier === tier) &&
          (position === 'ALL' || c.position === position) &&
          (season === 'ALL' || c.season === season),
      ),
    [cards, tier, position, season],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Deck composition. Counts, not fractions — see the note above. ── */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
      >
        {TIER_ORDER.map((t) => {
          const held = stats.byTier[t] ?? 0;
          const style = TIER_STYLE[t];
          return (
            <button
              key={t}
              onClick={() => setTier((cur) => (cur === t ? 'ALL' : t))}
              className="text-left rounded p-3 transition-opacity"
              style={{
                background: '#0e0e0f',
                border: `1px solid ${tier === t ? style.edge : '#1e1e20'}`,
                opacity: tier === 'ALL' || tier === t ? 1 : 0.45,
              }}
            >
              <div
                className="text-[10px] uppercase font-bold mb-2"
                style={{ letterSpacing: '0.16em', color: style.edge }}
              >
                {TIER_LABEL[t]}
              </div>
              <div className="text-lg font-bold" style={{ color: '#e8e6df' }}>
                {held}
                <span className="text-[10px] font-normal ml-1.5" style={{ color: '#555' }}>
                  × {DECK_POINTS[t]} pts
                </span>
              </div>
              <div
                className="mt-1.5 h-0.5 rounded"
                style={{ background: held > 0 ? style.frame : '#1e1e20' }}
              />
            </button>
          );
        })}
      </div>

      {afterTiers}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          id="deck-filter-position"
          label="Position"
          value={position}
          options={['ALL', ...POSITIONS]}
          onChange={setPosition}
        />
        <FilterSelect
          id="deck-filter-season"
          label="Season"
          value={String(season)}
          options={['ALL', ...seasons.map(String)]}
          onChange={(v) => setSeason(v === 'ALL' ? 'ALL' : Number(v))}
        />
        <span className="text-[10px] ml-auto" style={{ color: '#555' }}>
          {filtered.length} of {stats.cards} shown
        </span>
      </div>

      {/* ── The cards ── */}
      {filtered.length === 0 ? (
        <div
          className="rounded p-10 text-center text-xs"
          style={{ background: '#0e0e0f', border: '1px solid #1e1e20', color: '#555' }}
        >
          {stats.cards === 0
            ? 'No cards yet — open a pack to start your deck.'
            : 'No cards match those filters.'}
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
        >
          {filtered.map((card) => {
            const selected = card.id === selectedId;
            // Unselectable grids keep a plain div: a button that does nothing
            // is still focusable and still announced as a control.
            if (!onSelect) {
              return (
                <div key={card.id} className="flex justify-center">
                  <PlayerCard card={card} width={104} />
                </div>
              );
            }
            return (
              <button
                key={card.id}
                onClick={() => onSelect(card)}
                aria-pressed={selected}
                aria-label={`Select ${card.nickname || card.playerName}`}
                className="flex justify-center rounded transition-opacity"
                style={{
                  // The selected tile is the one at full strength rather than
                  // the one with a border added: an outline on a card that
                  // already has a metal frame reads as a rendering fault.
                  opacity: !selectedId || selected ? 1 : 0.5,
                  outline: selected ? '2px solid #80ff49' : 'none',
                  outlineOffset: 2,
                }}
              >
                <PlayerCard card={card} width={104} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One filter, as a dropdown.
 *
 * These were segmented buttons, which worked for the four positions and not at
 * all for seasons: the pool reaches back to 1999, so the Season row rendered
 * one button per year, grew without bound, and shoved the "N of M shown"
 * counter off the end of the row. A select collapses any number of options into
 * fixed width and costs nothing on the four-option case.
 *
 * Native rather than a custom menu — it gets keyboard handling, type-ahead and
 * the platform's touch picker for free, and this is a filter, not a place to
 * spend a bespoke component.
 *
 * The options carry their own colours because an unstyled <option> inherits the
 * OS list background, not the page's, which on a light system theme renders
 * near-white text on near-white.
 */
function FilterSelect({
  id, label, value, options, onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={id}
        className="text-[10px] uppercase"
        style={{ letterSpacing: '0.14em', color: '#444' }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[10px] rounded px-2 py-1 transition-colors"
        style={{
          background: '#0e0e0f',
          border: '1px solid #1e1e20',
          color: value === 'ALL' ? '#666' : '#80ff49',
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt} style={{ background: '#0e0e0f', color: '#e8e6df' }}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
