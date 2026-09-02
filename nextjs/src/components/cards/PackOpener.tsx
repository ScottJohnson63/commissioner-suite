'use client';

// src/components/cards/PackOpener.tsx
//
// The pack-opening graphic: a foil pack you tear open by pulling the strip off
// the top, and five face-down cards you turn over one at a time.
//
// Both interactions are deliberately manual. A pack that opened itself on a
// click and then dealt its cards on a timer told you what you got; making the
// tear a gesture and each card a decision is the part that is actually a game.
// Nothing advances on its own — the only timers here are the ones that let an
// animation finish.
//
// The reveal is one card at a time, and each card takes two clicks: the card
// comes up face down but drawn in its tier's metal, so you can see a Gold
// coming without knowing who it is, and the first click turns it over. The
// second brings up the next one. Showing the whole pack at once would give the
// best card away the moment the wrapper came off.
//
// Order matters to the drama: the API hands back the pack worst card first, so
// laying them out in array order puts the guaranteed card at the end of the row.

import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerCard, CardBack } from '@/components/cards/PlayerCard';
import { WildcardDie, WildcardFace } from '@/components/cards/WildcardReveal';
import { PACK_FOIL, TIER_STYLE } from '@/components/cards/tierStyles';
import { CARDS_PER_PACK, TIER_LABEL } from '@/lib/cards/tiers';
import type { CardTier, OpenPackResponse, PackKind, WildcardResponse } from '@/types/cards';

/** How far the pack must be pulled apart before it tears. */
const TEAR_DISTANCE = 120;
/** Length of the halves falling away, which the fetch runs underneath. */
const TEAR_MS = 620;

const PACK_W = 190;
const PACK_H = 282;

/**
 * The tear line: how far down the pack the strip comes off.
 *
 * A real pack tears across the top rather than splitting down the middle, so
 * the two pieces here are a shallow strip and the body below it. Both are drawn
 * as full-size copies of the same foil and then clipped to either side of this
 * line, which keeps the gradient continuous across the join — two separate
 * rectangles would show a visible step where their gradients restart.
 */
const TEAR_Y = 54;

/** Everything above the tear — the strip that comes off. */
const LID_CLIP =
  `polygon(0px 0px, ${PACK_W}px 0px, ${PACK_W}px ${TEAR_Y}px, 0px ${TEAR_Y}px)`;

/** Everything below it — the pack the cards come out of. */
const BODY_CLIP =
  `polygon(0px ${TEAR_Y}px, ${PACK_W}px ${TEAR_Y}px, ` +
  `${PACK_W}px ${PACK_H}px, 0px ${PACK_H}px)`;

type Phase = 'idle' | 'opening' | 'revealing';

export function PackOpener({
  remaining, nextPackTier, nextPackKind = 'RATION', onOpen, onRollWildcard, onFinished,
}: {
  remaining: number;
  /** Tier of the sealed pack, decided server-side before it is torn. */
  nextPackTier: CardTier | null;
  /** Which supply the sealed pack comes from. */
  nextPackKind?: PackKind;
  /** Spends a pack server-side. Rejects with a readable message on refusal. */
  onOpen: () => Promise<OpenPackResponse>;
  /** Throws a wildcard found in the pack currently being revealed. */
  onRollWildcard: (id: string) => Promise<WildcardResponse>;
  /** Called once every card in a pack has been turned over. */
  onFinished: (result: OpenPackResponse) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pack, setPack] = useState<OpenPackResponse | null>(null);
  // Which card is on screen, and whether it has been turned over yet. Two
  // fields rather than a set of revealed indices: only one card exists at a
  // time, so there is nothing to track about the others.
  const [index, setIndex] = useState(0);
  const [faceUp, setFaceUp] = useState(false);
  // Set once the last card has been turned and dismissed.
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending timers, so unmounting mid-animation cannot set state afterwards.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const start = useCallback(async () => {
    if (phase !== 'idle' || remaining <= 0) return;

    setError(null);
    setPack(null);
    setIndex(0);
    setFaceUp(false);
    setDone(false);
    setPhase('opening');

    // The halves fall away while the request is in flight, so the animation
    // covers the latency instead of following it.
    const [result] = await Promise.allSettled([onOpen(), wait(TEAR_MS)]);

    if (result.status === 'rejected') {
      setError(
        result.reason instanceof Error ? result.reason.message : 'Could not open that pack',
      );
      setPhase('idle');
      return;
    }

    setPack(result.value);
    setPhase('revealing');
  }, [phase, remaining, onOpen]);

  const allRevealed = done;

  // Tell the page once the last card is over, so it can re-read the deck.
  useEffect(() => {
    if (allRevealed && pack) onFinished(pack);
  }, [allRevealed, pack, onFinished]);

  /**
   * One click, whatever state the current card is in.
   *
   * Face down turns it over; face up moves to the next. The card on screen is
   * the only thing that can be acted on, so there is no index to pass and
   * nothing for a stray click to skip.
   */
  function advance() {
    if (!pack) return;
    if (!faceUp) { setFaceUp(true); return; }
    // A wildcard is revealed as one extra step after the last card, so the
    // guaranteed card still lands as the climax of the cards themselves and the
    // wildcard reads as the bonus it is.
    if (index < stepCount(pack) - 1) {
      setIndex((i) => i + 1);
      setFaceUp(false);
      return;
    }
    setDone(true);
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPack(null);
    setIndex(0);
    setFaceUp(false);
    setDone(false);
    setPhase('idle');
  }

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ minHeight: 420 }}>
      {phase === 'idle' && (
        <IdlePack
          remaining={remaining}
          tier={nextPackTier}
          kind={nextPackKind}
          error={error}
          onTear={() => void start()}
        />
      )}

      {phase === 'opening' && <Tearing tier={nextPackTier} />}

      {phase === 'revealing' && pack && (
        <Reveal
          pack={pack}
          index={index}
          faceUp={faceUp}
          onAdvance={advance}
          onRollWildcard={onRollWildcard}
          allRevealed={allRevealed}
          canOpenAnother={remaining > 0}
          onAgain={() => {
            reset();
            // A tick, so the idle pack mounts before the next one is torn.
            timers.current.push(setTimeout(() => void start(), 30));
          }}
          onDone={reset}
        />
      )}
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reveal steps in a pack: one per card, plus one for a wildcard if it found
 * any. The wildcard took a card's slot server-side, so this is still five
 * steps for a five-card pack — the difference is that one of them is the die.
 */
function stepCount(pack: OpenPackResponse): number {
  return pack.cards.length + (pack.wildcard ? 1 : 0);
}

// ─── The sealed pack, torn by dragging ────────────────────────────────────────

/**
 * A pack whose top strip has to be torn off.
 *
 * The strip follows the pointer sideways, which is how you actually open one:
 * grip the top and pull across. Drag past TEAR_DISTANCE and it commits, let go
 * short of it and the strip snaps back down.
 *
 * Pointer events rather than mouse or touch events so a finger, a mouse and a
 * stylus all take the same path, and `touch-action: none` so dragging on a
 * phone tears the pack instead of scrolling the page.
 *
 * Keyboard users get the same outcome from Enter or Space — a drag is a nice
 * gesture, not a thing to gate the feature behind.
 */
function IdlePack({
  remaining, tier, kind, error, onTear,
}: {
  remaining: number; tier: CardTier | null; kind: PackKind;
  error: string | null; onTear: () => void;
}) {
  const isBonus = kind === 'BONUS';
  const isStarter = kind === 'STARTER';
  const sealed = remaining > 0;
  // The wrapper is printed in the tier it contains, so a Hall of Fame pack is
  // an event before it is opened rather than after.
  const style = tier ? TIER_STYLE[tier] : null;

  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const committed = useRef(false);
  /**
   * Whether a drag is in progress, as a ref rather than the state above.
   *
   * `move` has to know this on the very next event, and a React state update
   * has not flushed by then — a fast enough drag (or a synthetic one) fires
   * pointermove while `dragging` is still false, and every one of those moves
   * is dropped. The state is kept purely for the cursor, which can lag a frame
   * without anyone noticing; the gate cannot.
   */
  const draggingRef = useRef(false);

  function down(e: React.PointerEvent) {
    if (!sealed) return;
    committed.current = false;
    startX.current = e.clientX;
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent) {
    if (!draggingRef.current || committed.current) return;
    // Distance in either direction — the pack pulls apart, so which way the
    // hand travels should not matter.
    const travelled = Math.abs(e.clientX - startX.current);
    const next = Math.min(1, travelled / TEAR_DISTANCE);
    setProgress(next);

    // Fire the moment the threshold is crossed rather than on release: the
    // pack is already visibly open by then, and waiting for pointerup makes
    // it feel like it stuck.
    if (next >= 1) {
      committed.current = true;
      draggingRef.current = false;
      setDragging(false);
      onTear();
    }
  }

  function up() {
    draggingRef.current = false;
    setDragging(false);
    if (!committed.current) setProgress(0);
  }

  // The strip travels sideways and lifts a little as it comes away.
  const slide = progress * 96;
  const lift = progress * 7;
  const tilt = progress * 9;
  const snapping = !dragging && progress === 0;

  return (
    <div className="flex flex-col items-center gap-6">
      <div
        role="button"
        tabIndex={sealed ? 0 : -1}
        aria-label={sealed ? 'Drag the top strip to tear the pack open' : 'No packs left this week'}
        aria-disabled={!sealed}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if (!sealed) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTear();
          }
        }}
        className="relative outline-none"
        style={{
          width: PACK_W, height: PACK_H,
          touchAction: 'none',
          cursor: sealed ? (dragging ? 'grabbing' : 'grab') : 'not-allowed',
          opacity: sealed ? 1 : 0.35,
        }}
      >
        {/* ── The pack below the tear, and the wordmark that stays with it ── */}
        <PackPiece clip={BODY_CLIP} foil={style?.frame ?? PACK_FOIL} />

        {/* The tier name sits on a dark plate rather than straight on the
            foil. Two of the four foils are bright metals, and the tier's own
            ink is a near-white chosen to sit on the dark card ground — on
            silver it disappears. The plate makes one treatment work on all
            four instead of needing a light and a dark variant. */}
        <div
          className="absolute inset-x-0 flex justify-center pointer-events-none"
          style={{ top: TEAR_Y + PACK_H * 0.2 }}
        >
          <div
            className="flex flex-col items-center gap-2 px-4 py-3 rounded"
            style={{
              background: 'rgba(8,8,10,0.72)',
              border: `1px solid ${style?.edge ?? '#3a3a44'}`,
              boxShadow: '0 4px 18px -6px rgba(0,0,0,0.8)',
            }}
          >
            {(isBonus || isStarter) && (
              <span
                className="font-black"
                style={{
                  fontSize: 8, letterSpacing: '0.2em', padding: '2px 6px',
                  borderRadius: 3, background: '#80ff49', color: '#0e0e0f',
                }}
              >
                {isStarter ? 'STARTER' : 'BONUS'}
              </span>
            )}
            <span
              className="font-black text-center"
              style={{
                fontSize: 12, letterSpacing: '0.16em', lineHeight: 1.3,
                color: style?.edge ?? '#80ff49',
              }}
            >
              {tier ? TIER_LABEL[tier].toUpperCase() : 'DRAFT DECK'}
            </span>
            <div style={{ width: 44, height: 1, background: style?.edge ?? '#3a3a44', opacity: 0.5 }} />
            <span
              className="font-bold"
              style={{ fontSize: 8, letterSpacing: '0.26em', color: '#8a8a96' }}
            >
              {CARDS_PER_PACK} CARDS
            </span>
          </div>
        </div>

        {/* Light out of the opening, brighter the further the strip is pulled.
            Sits above the body so it reads as coming from inside, and below the
            strip so the strip still covers it while the pack is shut. */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: 6, right: 6,
            top: TEAR_Y,
            height: Math.max(2, progress * 26),
            borderRadius: 999,
            background: `linear-gradient(180deg, ${style?.edge ?? 'rgba(128,255,73,0.95)'}, transparent)`,
            opacity: progress,
            filter: `blur(${3 + progress * 8}px)`,
          }}
        />

        {/* ── The strip that comes off ── */}
        <PackPiece
          clip={LID_CLIP}
          foil={style?.frame ?? PACK_FOIL}
          style={{
            transform: `translate(${slide}px, ${-lift}px) rotate(${tilt}deg)`,
            transformOrigin: 'left bottom',
            transition: snapping ? 'transform 0.3s cubic-bezier(0.2,0.8,0.3,1)' : 'none',
          }}
        >
          {/* The perforation and the nicks at either end of it are what tell
              you where the pack opens. They ride with the strip, so they leave
              with it once it is torn away. */}
          <TearPerforation fade={progress} />
          <TearNotch side="left" />
          <TearNotch side="right" />
        </PackPiece>
      </div>

      <div className="text-center" style={{ minHeight: 32 }}>
        {error ? (
          <p className="text-xs" style={{ color: '#ff6b6b' }}>{error}</p>
        ) : sealed ? (
          <>
            <p className="text-xs" style={{ color: '#666' }}>
              Pull the strip off the top to open it
            </p>
            <p className="text-[10px] mt-1" style={{ color: '#444' }}>
              {remaining} left this week
            </p>
          </>
        ) : (
          <p className="text-xs" style={{ color: '#666' }}>
            You&apos;ve opened every pack this week. More next week.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The little triangular nick at each end of the tear line.
 *
 * Cut in the wrapper's own colour-of-nothing so it reads as a gap rather than a
 * mark, the way the start-here nick on a real wrapper does.
 */
function TearNotch({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      className="absolute"
      style={{
        top: TEAR_Y - 4,
        [side]: 0,
        width: 0, height: 0,
        borderTop: '4px solid transparent',
        borderBottom: '4px solid transparent',
        [side === 'left' ? 'borderLeft' : 'borderRight']: '5px solid #0a0a0b',
      }}
    />
  );
}

/** Punched holes along the tear line. */
const PERF_HOLES = 21;

/**
 * The perforation along the tear.
 *
 * Both pieces of the wrapper are the same foil, so the join is invisible while
 * the pack is shut — which is right for the foil but leaves nothing to say
 * where it tears. A row of punched holes says it the way a real wrapper does,
 * and doubles as the "pull here" affordance.
 *
 * Each hole is a dark dot with a highlight under it, which is what a hole
 * punched through foil looks like: the shadow is the hole, the highlight is the
 * lit edge below it.
 *
 * Positioned just above TEAR_Y rather than centred on it. The strip is clipped
 * at exactly that line, so a hole straddling it would be sliced into a
 * semicircle.
 */
function TearPerforation({ fade }: { fade: number }) {
  return (
    <div
      className="absolute flex items-center justify-between pointer-events-none"
      style={{ left: 9, right: 9, top: TEAR_Y - 6, height: 4, opacity: 1 - fade }}
      aria-hidden
    >
      {Array.from({ length: PERF_HOLES }, (_, i) => (
        <span
          key={i}
          style={{
            width: 3, height: 3, borderRadius: '50%',
            background: 'rgba(0,0,0,0.75)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.18)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * One piece of the foil wrapper.
 *
 * Both the strip and the body are full-size copies of the same foil, each
 * clipped to its side of the serrated tear. Drawing them at full size rather
 * than as two rectangles is what keeps the gradient continuous across the join,
 * so the pack looks whole until it is pulled.
 */
function PackPiece({
  clip, style, children, foil = PACK_FOIL,
}: {
  clip: string; style?: React.CSSProperties;
  children?: React.ReactNode; foil?: string;
}) {
  return (
    <div
      className="absolute inset-0"
      style={{ clipPath: clip, WebkitClipPath: clip, ...style }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: foil,
          borderRadius: 13,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      />
      {children}
    </div>
  );
}

/**
 * The strip flicking away and the pack falling back, while the request is in
 * flight.
 *
 * Picks up from where the drag left off — the strip is already slid and tilted
 * at the moment it commits, and ut-lid-off starts from roughly that pose, so
 * the hand-off from gesture to animation does not jump.
 */
function Tearing({ tier }: { tier: CardTier | null }) {
  const foil = tier ? TIER_STYLE[tier].frame : PACK_FOIL;
  return (
    <div className="relative flex items-center justify-center" style={{ height: PACK_H + 40 }}>
      <div className="relative" style={{ width: PACK_W, height: PACK_H }}>
        <PackPiece
          clip={BODY_CLIP}
          foil={foil}
          style={{ animation: 'ut-body-off 0.62s ease-in forwards' }}
        />
        <PackPiece
          clip={LID_CLIP}
          foil={foil}
          style={{
            transformOrigin: 'left bottom',
            animation: 'ut-lid-off 0.62s ease-in forwards',
          }}
        />
      </div>
      <div
        className="absolute pointer-events-none"
        style={{
          width: 250, height: 250, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(128,255,73,0.55), transparent 62%)',
          animation: 'ut-flare 0.75s ease-out forwards',
        }}
      />
    </div>
  );
}

// ─── The reveal: five cards, turned over by hand ───────────────────────────────

/**
 * The reveal: one card on screen, two clicks each.
 *
 * The card arrives face down but in its tier's metal, so a Gold announces
 * itself before you know who it is. The first click turns it over, the second
 * brings up the next one. Once the last has been dismissed the whole pack is
 * laid out at once, which is the only point at which seeing everything together
 * is useful rather than a spoiler.
 */
function Reveal({
  pack, index, faceUp, onAdvance, onRollWildcard, allRevealed, canOpenAnother, onAgain, onDone,
}: {
  pack: OpenPackResponse;
  /** Which step is on screen. */
  index: number;
  /** Whether that card has been turned over. */
  faceUp: boolean;
  /** Turns the card over, or moves to the next one. */
  onAdvance: () => void;
  /** Throws the wildcard this pack carried. */
  onRollWildcard: (id: string) => Promise<WildcardResponse>;
  allRevealed: boolean;
  canOpenAnother: boolean;
  onAgain: () => void;
  onDone: () => void;
}) {
  const packStyle = TIER_STYLE[pack.packTier];

  if (allRevealed) {
    return (
      <PackSummary
        pack={pack}
        canOpenAnother={canOpenAnother}
        onAgain={onAgain}
        onDone={onDone}
      />
    );
  }

  const total = stepCount(pack);
  // Past the last card is the wildcard step, when the pack found one.
  const onWildcard = Boolean(pack.wildcard) && index >= pack.cards.length;
  const card = onWildcard ? null : pack.cards[index];

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      <div className="flex flex-col items-center gap-1.5">
        {pack.packKind !== 'RATION' && (
          <span
            className="text-[9px] uppercase font-black px-2 py-1 rounded"
            style={{ letterSpacing: '0.22em', background: '#80ff49', color: '#0e0e0f' }}
          >
            {pack.packKind === 'STARTER' ? 'Starter pack' : 'Bonus pack'} · {total} cards
          </span>
        )}
        <p
          className="text-[10px] uppercase font-bold"
          style={{ letterSpacing: '0.28em', color: packStyle.edge }}
        >
          {TIER_LABEL[pack.packTier]} Pack · {index + 1} of {total}
        </p>
      </div>

      {onWildcard && pack.wildcard ? (
        <WildcardStep
          id={pack.wildcard.id}
          faceUp={faceUp}
          onClick={onAdvance}
          onRoll={onRollWildcard}
        />
      ) : (
        card && <StepCard card={card} faceUp={faceUp} onClick={onAdvance} />
      )}

      <div className="flex flex-col items-center gap-3">
        {/* One pip per step: filled for turned, outlined for the one in hand. */}
        <div className="flex flex-wrap justify-center gap-1.5" style={{ maxWidth: 260 }}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i < index || (i === index && faceUp) ? '#80ff49' : '#2a2a2c',
                outline: i === index && !faceUp ? '1px solid #80ff49' : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
        <p className="text-xs" style={{ color: '#666' }}>
          {faceUp
            ? index < total - 1
              ? 'Click for the next card'
              : 'Click to finish'
            : 'Click to turn it over'}
        </p>
      </div>
    </div>
  );
}

/**
 * The wildcard step: the same two-click rhythm as a card, then a die.
 *
 * Turning it over does not advance — the die has to be thrown first, and a
 * click that both revealed the wildcard and skipped past it would be the one
 * way to lose the thing you just found. Once it has been thrown, the click
 * target moves back to the card and the reveal continues as normal.
 */
function WildcardStep({
  id, faceUp, onClick, onRoll,
}: {
  id: string;
  faceUp: boolean;
  onClick: () => void;
  onRoll: (id: string) => Promise<WildcardResponse>;
}) {
  const [rolled, setRolled] = useState<number | null>(null);

  const roll = useCallback(async () => {
    const result = await onRoll(id);
    setRolled(result.value);
    return result;
  }, [id, onRoll]);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={faceUp ? undefined : onClick}
        disabled={faceUp}
        aria-label={faceUp ? 'A wildcard' : 'A card, face down. Click to turn it over'}
        className="relative outline-none"
        style={{
          width: STEP_CARD_W,
          perspective: 1000,
          cursor: faceUp ? 'default' : 'pointer',
          background: 'none',
          border: 0,
          padding: 0,
        }}
      >
        {faceUp && (
          <div
            className="absolute pointer-events-none"
            style={{
              inset: '-26%', borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(192,139,255,0.45), transparent 62%)',
              animation: 'ut-burst 0.9s ease-out forwards',
            }}
          />
        )}

        <div
          className="ut-card-flip relative"
          style={{
            transformStyle: 'preserve-3d',
            transition: 'transform 0.55s cubic-bezier(0.2, 0.8, 0.3, 1)',
            transform: faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)',
            ...(faceUp ? { animation: 'ut-pop 0.55s ease-out' } : {}),
          }}
        >
          <WildcardFace width={STEP_CARD_W} />
          <div
            className="absolute inset-0"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            {/* Face down it is indistinguishable from a card — finding out it is
                not one is the moment this whole step exists for. */}
            <CardBack width={STEP_CARD_W} tier="GOLD" />
          </div>
        </div>
      </button>

      {faceUp && (
        <>
          <WildcardDie rolled={rolled} onRoll={roll} size={56} />
          {/* Always offered, thrown or not. Gating this on a successful roll
              trapped the reveal: a die whose request failed left no way
              forward at all. The wildcard is already owned server-side by the
              time it is on screen, so leaving without throwing it loses
              nothing — the Packs tab lists it until it is thrown. */}
          <button
            onClick={onClick}
            className="text-xs underline underline-offset-4"
            style={{ color: '#666', background: 'none', border: 0, cursor: 'pointer' }}
          >
            {rolled != null ? 'Continue' : 'Throw it later'}
          </button>
        </>
      )}
    </div>
  );
}

const STEP_CARD_W = 220;

/**
 * The single card in hand.
 *
 * Both faces are mounted and rotated together, so the flip is a real turn
 * rather than a swap — and the back carries the tier colour, which is the part
 * that makes waiting for the flip worth anything.
 */
function StepCard({
  card, faceUp, onClick,
}: { card: OpenPackResponse['cards'][number]; faceUp: boolean; onClick: () => void }) {
  const tier = TIER_STYLE[card.tier];

  return (
    <button
      onClick={onClick}
      aria-label={
        faceUp
          ? `${card.playerName}, ${TIER_LABEL[card.tier]}. Click for the next card`
          : `A ${TIER_LABEL[card.tier]} card, face down. Click to turn it over`
      }
      className="relative outline-none"
      style={{ width: STEP_CARD_W, perspective: 1000, cursor: 'pointer' }}
    >
      {/* The burst only fires once the card is known — before that its colour
          is already on the back, and a second glow would just be noise. */}
      {faceUp && (
        <div
          className="absolute pointer-events-none"
          style={{
            inset: '-26%', borderRadius: '50%',
            background: `radial-gradient(circle, ${tier.glow}, transparent 62%)`,
            animation: 'ut-burst 0.9s ease-out forwards',
          }}
        />
      )}

      {/* Keyed on the card so each new one mounts fresh and animates in. */}
      <div
        key={card.id}
        className="ut-card-flip relative"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.55s cubic-bezier(0.2, 0.8, 0.3, 1)',
          transform: faceUp ? 'rotateY(0deg)' : 'rotateY(180deg)',
          ...(faceUp ? { animation: 'ut-pop 0.55s ease-out' } : {}),
        }}
      >
        <PlayerCard
          card={card}
          width={STEP_CARD_W}
          showTierName
          style={{ backfaceVisibility: 'hidden' }}
        />
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <CardBack width={STEP_CARD_W} tier={card.tier} />
        </div>
      </div>
    </button>
  );
}

/** Everything the pack held, once every card has been turned. */
function PackSummary({
  pack, canOpenAnother, onAgain, onDone,
}: {
  pack: OpenPackResponse;
  canOpenAnother: boolean;
  onAgain: () => void;
  onDone: () => void;
}) {
  const style = TIER_STYLE[pack.packTier];

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      <p
        className="text-[10px] uppercase font-bold"
        style={{ letterSpacing: '0.28em', color: style.edge }}
      >
        {TIER_LABEL[pack.packTier]} Pack · {pack.cards.length} cards
      </p>

      <div className="flex flex-wrap items-end justify-center gap-2.5">
        {/* Best last in the deal order, so reversing puts it first here. */}
        {[...pack.cards].reverse().map((card, i) => (
          <div
            key={`${card.id}-${i}`}
            style={{ animation: `ut-rise 0.35s ease-out ${i * 45}ms both` }}
          >
            <PlayerCard card={card} width={92} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onAgain}
          disabled={!canOpenAnother}
          className="text-xs font-medium px-4 py-2 rounded transition-opacity disabled:opacity-40"
          style={{ background: '#80ff49', color: '#0e0e0f' }}
        >
          {canOpenAnother ? `Open another (${pack.allowance.remaining})` : 'No packs left'}
        </button>
        <button
          onClick={onDone}
          className="text-xs px-4 py-2 rounded transition-colors"
          style={{ color: '#666', border: '1px solid #1e1e20' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

