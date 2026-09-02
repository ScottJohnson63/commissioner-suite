'use client';

// src/components/cards/RosterPanel.tsx
//
// The starting lineup: ten slots, filled from the cards you own.
//
// This is where the game stops being a collection and becomes a set of
// decisions. Owning a second elite kicker is worth nothing once a better one
// holds the slot, so what matters is which ten you field — and the standings
// rank on exactly that.
//
// An empty slot is drawn as something you can click rather than as an absence,
// because an empty lineup should read as ten invitations rather than a blank.

import { useMemo, useState } from 'react';
import { PlayerCard } from '@/components/cards/PlayerCard';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import type { CardDto, DeckStatsDto, OwnedCardDto, RosterSlotDto } from '@/types/cards';

export function RosterPanel({
  roster, cards, stats, onAssign, busySlot,
}: {
  roster: RosterSlotDto[];
  /** Everything the member owns — the pool the picker draws from. */
  cards: OwnedCardDto[];
  stats: DeckStatsDto;
  /** Sets or clears a slot. Rejects with a readable message. */
  onAssign: (slotId: string, cardId: string | null) => Promise<void>;
  /** Slot currently being written, so it can show as pending. */
  busySlot: string | null;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Cards already starting, so the picker can mark them. */
  const startedIds = useMemo(
    () => new Set(roster.map((s) => s.card?.id).filter(Boolean) as string[]),
    [roster],
  );

  const openSlot = roster.find((s) => s.id === picking) ?? null;

  /**
   * Eligible cards for the open slot, best first.
   *
   * Filtered by the same rule the server enforces. A card already starting
   * elsewhere is still offered — picking it moves it, which is friendlier than
   * making someone empty the other slot first.
   */
  const candidates = useMemo(() => {
    if (!openSlot) return [];
    return cards
      .filter((c) => openSlot.accepts.includes(c.position))
      .sort((a, b) => b.pointsPerGame - a.pointsPerGame);
  }, [openSlot, cards]);

  async function assign(slotId: string, cardId: string | null) {
    setError(null);
    try {
      await onAssign(slotId, cardId);
      setPicking(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the lineup');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span
          className="text-[10px] uppercase font-bold"
          style={{ letterSpacing: '0.16em', color: '#444' }}
        >
          Starting lineup
        </span>
        <span className="text-[10px]" style={{ color: '#555' }}>
          {stats.started} of {roster.length} filled
        </span>
        <span className="text-xs ml-auto font-bold" style={{ color: '#80ff49' }}>
          {stats.rosterPpg.toFixed(1)}
          <span className="text-[10px] font-normal ml-1" style={{ color: '#555' }}>
            PPG
          </span>
        </span>
      </div>

      {/* ── The ten slots ── */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
      >
        {roster.map((slot) => (
          <SlotTile
            key={slot.id}
            slot={slot}
            busy={busySlot === slot.id}
            onClick={() => setPicking((cur) => (cur === slot.id ? null : slot.id))}
            active={picking === slot.id}
          />
        ))}
      </div>

      {error && <p className="text-[11px]" style={{ color: '#ff6b6b' }}>{error}</p>}

      {/* ── Picker for the open slot ── */}
      {openSlot && (
        <div className="rounded p-3" style={{ background: '#0e0e0f', border: '1px solid #1e1e20' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold" style={{ color: '#e8e6df' }}>
              {openSlot.label}
            </span>
            <span className="text-[10px]" style={{ color: '#555' }}>
              {openSlot.accepts.join(' · ')}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {openSlot.card && (
                <button
                  onClick={() => void assign(openSlot.id, null)}
                  className="text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded"
                  style={{ color: '#ff6b6b', border: '1px solid #2a2a2c' }}
                >
                  Bench
                </button>
              )}
              <button
                onClick={() => setPicking(null)}
                className="text-[10px] uppercase tracking-[0.16em]"
                style={{ color: '#555' }}
              >
                Close
              </button>
            </div>
          </div>

          {candidates.length === 0 ? (
            <p className="text-[11px] py-4 text-center" style={{ color: '#555' }}>
              No {openSlot.accepts.join('/')} cards in your deck yet — open some packs.
            </p>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}
            >
              {candidates.map((card) => (
                <PickCandidate
                  key={card.id}
                  card={card}
                  starting={startedIds.has(card.id)}
                  inThisSlot={openSlot.card?.id === card.id}
                  onClick={() => void assign(openSlot.id, card.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SlotTile({
  slot, busy, active, onClick,
}: { slot: RosterSlotDto; busy: boolean; active: boolean; onClick: () => void }) {
  const tier = slot.card ? TIER_STYLE[slot.card.tier] : null;

  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center rounded p-1.5 transition-opacity"
      style={{
        background: '#0e0e0f',
        border: `1px solid ${active ? '#80ff49' : tier?.edge ?? '#1e1e20'}`,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <span
        className="text-[9px] uppercase font-bold mb-1.5"
        style={{ letterSpacing: '0.14em', color: active ? '#80ff49' : '#555' }}
      >
        {slot.label}
      </span>

      {slot.card ? (
        <>
          <PlayerCard card={slot.card} width={72} />
          <span
            className="text-[10px] font-bold mt-1.5 tabular-nums"
            style={{ color: '#e8e6df' }}
          >
            {slot.card.pointsPerGame.toFixed(1)}
          </span>
        </>
      ) : (
        <EmptySlot />
      )}
    </button>
  );
}

/** The dashed outline of a slot waiting to be filled. */
function EmptySlot() {
  return (
    <>
      <div
        className="flex items-center justify-center"
        style={{
          width: 72, aspectRatio: '2 / 3', borderRadius: 5,
          border: '1px dashed #2a2a2c', background: '#0a0a0b',
        }}
      >
        <span style={{ fontSize: 18, color: '#2a2a2c', lineHeight: 1 }}>+</span>
      </div>
      <span className="text-[10px] mt-1.5" style={{ color: '#333' }}>—</span>
    </>
  );
}

function PickCandidate({
  card, starting, inThisSlot, onClick,
}: { card: CardDto; starting: boolean; inThisSlot: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative flex flex-col items-center" disabled={inThisSlot}>
      <PlayerCard
        card={card}
        width={88}
        style={{ opacity: inThisSlot ? 0.45 : starting ? 0.7 : 1 }}
      />
      <span className="text-[10px] font-bold mt-1 tabular-nums" style={{ color: '#e8e6df' }}>
        {card.pointsPerGame.toFixed(1)}
      </span>
      {/* Already in the lineup somewhere — picking it here moves it. */}
      {starting && !inThisSlot && (
        <span
          className="absolute font-bold"
          style={{
            top: -3, right: -3, fontSize: 8, padding: '1px 4px', borderRadius: 3,
            background: '#1e1e20', color: '#80ff49', border: '1px solid #2a2a2c',
          }}
        >
          IN
        </span>
      )}
    </button>
  );
}
