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
// **Rows, not tiles.** A lineup is read across, not admired: the question it
// answers is "which of my ten is weakest", and that is a comparison between
// slots. Slot tiles that rendered the card at the tile's own width put one slot
// on a phone screen and roughly five thousand pixels of scroll between the
// first and the tenth, which makes that comparison a memory test — and buried
// the picker below the fold on whichever slot you tapped. A row is about 85px
// tall, so the whole lineup fits in a screen and a half.
//
// Nothing is lost by shrinking the art, because the art was never carrying the
// text: PlayerCard scales its own type off its `width` prop, so a card in a
// list is a portrait and a tier colour whatever size it is drawn at. The row
// sets the name and the PPG in real type beside the chip instead, which is
// strictly more legible than the card's own name band was, and the chip stays
// tappable in its own right — it opens the full card.
//
// An empty slot is drawn as something you can click rather than as an absence,
// because an empty lineup should read as ten invitations rather than a blank.

import { useMemo, useState } from 'react';
import { CardsDialog } from '@/components/cards/CardsDialog';
import { PlayerCard } from '@/components/cards/PlayerCard';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import { TIER_LABEL } from '@/lib/cards/tiers';
import type { DeckStatsDto, OwnedCardDto, RosterSlotDto } from '@/types/cards';

/** The card chip on a lineup row. 2:3, so the row is this plus padding. */
const ROW_CARD_W = 46;

/** A candidate card in the picker. Wide enough to read the portrait by. */
const PICK_CARD_W = 92;

export function RosterPanel({
  roster, cards, stats, onAssign, busySlot, onInspect,
}: {
  roster: RosterSlotDto[];
  /** Everything the member owns — the pool the picker draws from. */
  cards: OwnedCardDto[];
  stats: DeckStatsDto;
  /** Sets or clears a slot. Rejects with a readable message. */
  onAssign: (slotId: string, cardId: string | null) => Promise<void>;
  /** Slot currently being written, so it can show as pending. */
  busySlot: string | null;
  /**
   * Opens one card full size, by id. Wired to the deck's own card dialog by
   * the page, which is where a card is already shown at 260px with everything
   * you can do to it — the row's chip is the way into it from here.
   *
   * Optional: without it the chip is inert and the picker is the only place
   * cards render large, which is still a usable lineup.
   */
  onInspect?: (cardId: string) => void;
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
   * Filtered by the same rules the server enforces: the right position, and not
   * already retired. A card plays one week a season, so once it has played it
   * is out of the picker for good — offering it and refusing the click would be
   * a worse way to tell somebody that.
   *
   * A card already starting elsewhere *is* still offered — picking it moves it,
   * which is friendlier than making someone empty the other slot first.
   */
  const candidates = useMemo(() => {
    if (!openSlot) return [];
    return cards
      .filter((c) => c.retiredWeek === null && openSlot.accepts.includes(c.position))
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

      {/* ── The slots ──
          One column on a phone, two on anything wider: a row is legible at
          about 300px, so a wide screen fits two side by side and halves the
          scroll again rather than stretching one row across a desktop. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {roster.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            busy={busySlot === slot.id}
            active={picking === slot.id}
            onPick={() => setPicking(slot.id)}
            onInspect={onInspect}
          />
        ))}
      </div>

      {error && <p className="text-[11px]" style={{ color: '#ff6b6b' }}>{error}</p>}

      {/* ── The picker ──
          A sheet over the page rather than a block opened underneath the row
          that was tapped. Inline meant the options appeared below whatever the
          row cost in height and below however far down the list you were, so
          the act of choosing started with a scroll. Over the page, the slot you
          are filling is pinned at the top and the candidates start at the top
          of the screen, every time, from any slot. */}
      <CardsDialog
        open={openSlot !== null}
        onClose={() => setPicking(null)}
        title={openSlot ? `Lineup · ${openSlot.label}` : 'Lineup'}
        widthClassName="sm:max-w-2xl"
      >
        {openSlot && (
          <PickerBody
            slot={openSlot}
            candidates={candidates}
            startedIds={startedIds}
            onAssign={assign}
          />
        )}
      </CardsDialog>
    </div>
  );
}

/**
 * One slot as a row: the card chip, who is in it, and what they score.
 *
 * Two targets rather than one, which is why this is a div holding two buttons
 * rather than one button around everything. The chip opens the card full size;
 * the rest of the row opens the picker. Both are well over the 44px a finger
 * needs, and nesting a button inside a button would be neither.
 */
function SlotRow({
  slot, busy, active, onPick, onInspect,
}: {
  slot: RosterSlotDto;
  busy: boolean;
  active: boolean;
  onPick: () => void;
  onInspect?: (cardId: string) => void;
}) {
  // Carries the owner's nickname and portrait — see LineupCardDto. The card
  // here is the same card the deck shows, not the pool's copy of it.
  const card = slot.card;
  const tier = card ? TIER_STYLE[card.tier] : null;

  return (
    <div
      className="flex items-stretch gap-3 rounded p-2 transition-opacity"
      style={{
        background: '#0e0e0f',
        border: `1px solid ${active ? '#80ff49' : '#1e1e20'}`,
        // The tier as a spine down the left edge rather than a ring around the
        // whole row. Ten tier-coloured outlines stacked up read as ten alerts;
        // a spine says the same thing at the same glance and lets the row
        // itself stay quiet. The chip's own frame carries the tier too, and the
        // line under the name spells it out.
        borderLeft: `3px solid ${active ? '#80ff49' : tier?.edge ?? '#1e1e20'}`,
        opacity: busy ? 0.5 : 1,
      }}
    >
      {/* ── The chip ──
          A real card, drawn small. Tapping it opens the full one; with no
          handler wired it is not a control at all, rather than a dead button. */}
      {!card ? (
        <EmptyChip />
      ) : onInspect ? (
        <button
          type="button"
          onClick={() => onInspect(card.id)}
          aria-label={`View ${card.nickname || card.playerName}'s card`}
          className="shrink-0 self-center"
        >
          <PlayerCard card={card} width={ROW_CARD_W} />
        </button>
      ) : (
        <div className="shrink-0 self-center">
          <PlayerCard card={card} width={ROW_CARD_W} />
        </div>
      )}

      {/* ── The row ──
          Labelled rather than left to read out its own contents: a screen
          reader announcing "RB Jamal Lewis BAL RB Gold 18.8 PPG" says nothing
          about what the row *does*, and what it does is open the picker. */}
      <button
        type="button"
        onClick={onPick}
        aria-label={
          card
            ? `Change ${slot.label} — ${card.nickname || card.playerName}`
            : `Fill ${slot.label} — empty`
        }
        className="flex-1 min-w-0 flex items-center gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[9px] uppercase font-bold"
            style={{ letterSpacing: '0.14em', color: active ? '#80ff49' : '#555' }}
          >
            {slot.label}
          </div>

          {card ? (
            <>
              <div
                className="text-sm font-bold truncate mt-0.5"
                style={{ color: '#e8e6df' }}
              >
                {card.nickname || card.playerName}
              </div>
              <div className="text-[10px] truncate mt-0.5" style={{ color: '#555' }}>
                {[card.team, card.position, TIER_LABEL[card.tier]]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm mt-0.5" style={{ color: '#6a6a70' }}>
                Empty
              </div>
              <div className="text-[10px] truncate mt-0.5" style={{ color: '#444' }}>
                {slot.accepts.join(' · ')}
              </div>
            </>
          )}
        </div>

        {/* The number the standings run on, in the one place the eye can
            compare it down the column. */}
        <div className="shrink-0 text-right">
          {card ? (
            <>
              <div
                className="text-base font-bold tabular-nums leading-none"
                style={{ color: '#e8e6df' }}
              >
                {card.pointsPerGame.toFixed(1)}
              </div>
              <div
                className="text-[8px] uppercase font-bold mt-1"
                style={{ letterSpacing: '0.12em', color: '#555' }}
              >
                PPG
              </div>
            </>
          ) : (
            <div className="text-base leading-none" style={{ color: '#2a2a2c' }}>
              +
            </div>
          )}
        </div>

        <Chevron />
      </button>
    </div>
  );
}

/** The dashed outline of a slot waiting to be filled, at chip size. */
function EmptyChip() {
  return (
    <div
      className="shrink-0 self-center flex items-center justify-center"
      style={{
        width: ROW_CARD_W, aspectRatio: '2 / 3', borderRadius: 5,
        border: '1px dashed #2a2a2c', background: '#0a0a0b',
      }}
    >
      <span style={{ fontSize: ROW_CARD_W * 0.25, color: '#2a2a2c', lineHeight: 1 }}>+</span>
    </div>
  );
}

/** The affordance that says the row opens something. */
function Chevron() {
  return (
    <svg
      className="shrink-0"
      width="7" height="12" viewBox="0 0 7 12" fill="none"
      stroke="#3a3a3e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 1l5 5-5 5" />
    </svg>
  );
}

/**
 * What the picker sheet holds: which slot this is, then the cards for it.
 *
 * The slot's own line stays at the top of the body rather than scrolling away
 * with the grid — on a long list of receivers, "which slot am I filling" is the
 * thing you lose first, and Bench belongs next to it because benching is a
 * decision about the slot rather than about any of the cards below.
 */
function PickerBody({
  slot, candidates, startedIds, onAssign,
}: {
  slot: RosterSlotDto;
  candidates: OwnedCardDto[];
  startedIds: Set<string>;
  onAssign: (slotId: string, cardId: string | null) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Not pinned. A sticky heading inside the dialog's padded, scrolling body
          can only stick to the top of that body's content box, which leaves a
          band above it for cards to scroll through and puts it over the first
          row of them at rest. It does not need to be pinned anyway: the
          dialog's own header names the slot — "Lineup · FLEX" — and that never
          scrolls, so this line is the detail rather than the label. */}
      <div
        className="flex items-center gap-3 pb-3"
        style={{ borderBottom: '1px solid #1e1e20' }}
      >
        <span className="text-sm font-bold" style={{ color: '#e8e6df' }}>
          {slot.label}
        </span>
        <span className="text-[10px]" style={{ color: '#555' }}>
          {slot.accepts.join(' · ')}
        </span>
        {slot.card && (
          <button
            type="button"
            onClick={() => void onAssign(slot.id, null)}
            className="ml-auto text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded"
            style={{ color: '#ff6b6b', border: '1px solid #2a2a2c' }}
          >
            Bench
          </button>
        )}
      </div>

      {candidates.length === 0 ? (
        <p className="text-[11px] py-4 text-center" style={{ color: '#555' }}>
          No {slot.accepts.join('/')} cards left to play — every one you hold has
          already had its week. Open some packs.
        </p>
      ) : (
        <>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PICK_CARD_W}px, 1fr))` }}
          >
            {candidates.map((card) => (
              <PickCandidate
                key={card.id}
                card={card}
                starting={startedIds.has(card.id)}
                inThisSlot={slot.card?.id === card.id}
                onClick={() => void onAssign(slot.id, card.id)}
              />
            ))}
          </div>
          <p className="text-[10px] text-center" style={{ color: '#444' }}>
            {candidates.length} eligible · best first
          </p>
        </>
      )}
    </div>
  );
}

function PickCandidate({
  card, starting, inThisSlot, onClick,
}: { card: OwnedCardDto; starting: boolean; inThisSlot: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The card's own face is a picture as far as a screen reader is
      // concerned, so the button says who it is, what they score, and whether
      // picking it would move them out of another slot.
      aria-label={[
        inThisSlot ? 'Already in this slot:' : 'Start',
        card.nickname || card.playerName,
        `— ${card.pointsPerGame.toFixed(1)} PPG`,
        starting && !inThisSlot ? '(currently in another slot)' : '',
      ].filter(Boolean).join(' ')}
      className="relative flex flex-col items-center min-w-0"
      disabled={inThisSlot}
    >
      <PlayerCard
        card={card}
        width={PICK_CARD_W}
        style={{ opacity: inThisSlot ? 0.45 : starting ? 0.7 : 1 }}
      />
      {/* The name in real type under the card, not only in its own band: at
          92px the band is decoration, and picking a card is exactly the moment
          you need to be sure which player it is. */}
      <span
        className="text-[10px] font-medium mt-1.5 w-full truncate text-center"
        style={{ color: '#c8c6c0' }}
      >
        {card.nickname || card.playerName}
      </span>
      <span className="text-[11px] font-bold tabular-nums" style={{ color: '#e8e6df' }}>
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
