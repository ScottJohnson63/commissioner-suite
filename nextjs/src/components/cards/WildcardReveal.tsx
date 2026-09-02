'use client';

// src/components/cards/WildcardReveal.tsx
//
// The wildcard: a card you find in a pack, and the die it lets you throw.
//
// This replaced a tile that sat on the page all week offering a free roll to
// anyone who loaded it. As a card it has to be pulled — Silver packs and better
// — which is the only version that interacts with the game rather than with the
// calendar.
//
// The die is thrown on the server, because a die thrown in the browser is one
// you can throw until you like the answer. The tumble here is theatre over a
// result that has already been decided. It is honest theatre: the faces shown
// while it spins are random, and the moment it settles it shows what the server
// actually returned.

import { useEffect, useRef, useState } from 'react';
import type { PendingWildcardDto, WildcardResponse } from '@/types/cards';

/** How long the die tumbles before settling on the real face. */
const TUMBLE_MS = 900;

/** The wildcard's own colour, deliberately not one of the four tier metals. */
const WILD_INK = '#c08bff';
const WILD_GLOW = 'rgba(192,139,255,0.45)';

/**
 * A found wildcard, and the die for it.
 *
 * `rolled` is the authoritative face once the page behind this has re-read;
 * only the tumbling faces live in state. Keeping a second copy of the settled
 * value meant an effect to resync it with the prop, which was deriving state
 * from props the long way round.
 */
export function WildcardDie({
  rolled, onRoll, size = 46,
}: {
  /** The face already thrown, or null while the die is still on the table. */
  rolled: number | null;
  onRoll: () => Promise<WildcardResponse>;
  size?: number;
}) {
  const [tumbleFace, setTumbleFace] = useState(1);
  const [tumbling, setTumbling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearInterval);
      timers.current = [];
    },
    [],
  );

  async function throwDie() {
    // The guard is here as well as on the server. The server's is the one that
    // matters; this one stops the tumble restarting mid-flight and showing a
    // second, fictional roll.
    if (tumbling || rolled != null) return;

    setError(null);
    setTumbling(true);

    const spin = setInterval(() => setTumbleFace(1 + Math.floor(Math.random() * 6)), 90);
    timers.current.push(spin);

    try {
      const [result] = await Promise.all([
        onRoll(),
        new Promise((r) => setTimeout(r, TUMBLE_MS)),
      ]);
      clearInterval(spin);
      // Land on the real result. The page re-read behind this makes `rolled`
      // agree a moment later, and the derived face below picks it up.
      setTumbleFace(result.value);
    } catch (e) {
      clearInterval(spin);
      setError(e instanceof Error ? e.message : 'Could not roll');
    } finally {
      setTumbling(false);
    }
  }

  const face = rolled ?? tumbleFace;
  const settled = rolled != null;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={throwDie}
        disabled={settled || tumbling}
        aria-label={
          settled
            ? `Rolled ${rolled}, worth ${rolled} extra ${rolled === 1 ? 'pack' : 'packs'}`
            : 'Roll the wildcard die'
        }
        className="outline-none"
        style={{ cursor: settled || tumbling ? 'default' : 'pointer', background: 'none', border: 0, padding: 0 }}
      >
        <DieFace value={face} active={settled} tumbling={tumbling} size={size} />
      </button>

      {error ? (
        <p className="text-[11px]" style={{ color: '#ff6b6b' }}>{error}</p>
      ) : settled ? (
        <p className="text-[11px] font-bold" style={{ color: '#80ff49' }}>
          +{rolled} extra {rolled === 1 ? 'pack' : 'packs'}
        </p>
      ) : (
        <p className="text-[11px]" style={{ color: '#666' }}>
          {tumbling ? 'Rolling…' : 'Click the die to roll'}
        </p>
      )}
    </div>
  );
}

/**
 * The wildcard's card face, sized like a player card so it can take a card's
 * place in the reveal without the layout jumping.
 */
export function WildcardFace({ width }: { width: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2"
      style={{
        width,
        aspectRatio: '5 / 7',
        // Mounted back-to-back with the card back in the flip, so it has to
        // disappear when turned away — without this both faces show at once.
        backfaceVisibility: 'hidden',
        borderRadius: width * 0.05,
        background: 'linear-gradient(160deg, #241a33 0%, #14101c 55%, #1d1428 100%)',
        border: `1px solid ${WILD_INK}`,
        boxShadow: `0 0 ${width * 0.12}px ${WILD_GLOW}`,
        color: WILD_INK,
      }}
    >
      <span
        className="font-black"
        style={{ fontSize: width * 0.26, lineHeight: 1 }}
        aria-hidden="true"
      >
        ★
      </span>
      <span
        className="uppercase font-black"
        style={{ fontSize: width * 0.075, letterSpacing: '0.22em' }}
      >
        Wildcard
      </span>
      <span
        className="text-center"
        style={{ fontSize: width * 0.055, color: '#8a7ba8', maxWidth: '78%', lineHeight: 1.5 }}
      >
        Throw the die for one to six extra packs
      </span>
    </div>
  );
}

/**
 * Wildcards found in earlier packs and never thrown.
 *
 * Shown outside the opener so a die cannot be stranded: a member who closed the
 * tab mid-reveal still owns the wildcard, and the server will still honour it,
 * so the page has to offer it somewhere.
 */
export function PendingWildcards({
  wildcards, onRoll,
}: {
  wildcards: PendingWildcardDto[];
  onRoll: (id: string) => Promise<WildcardResponse>;
}) {
  if (!wildcards.length) return null;

  return (
    <div
      className="rounded p-4 flex flex-wrap items-center gap-5"
      style={{ background: 'rgba(192,139,255,0.06)', border: `1px solid ${WILD_INK}` }}
    >
      <div>
        <div
          className="text-[10px] uppercase font-bold mb-1"
          style={{ letterSpacing: '0.16em', color: WILD_INK }}
        >
          {wildcards.length === 1 ? 'Wildcard found' : `${wildcards.length} wildcards found`}
        </div>
        <p className="text-[11px]" style={{ color: '#8a7ba8' }}>
          Unthrown. Each is worth one to six extra packs.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4 ml-auto">
        {wildcards.map((w) => (
          <WildcardDie key={w.id} rolled={null} onRoll={() => onRoll(w.id)} size={40} />
        ))}
      </div>
    </div>
  );
}

/** Pip positions on a d6 face, as a 3×3 grid. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

function DieFace({
  value, active, tumbling, size,
}: { value: number; active: boolean; tumbling: boolean; size: number }) {
  return (
    <div
      className="grid"
      style={{
        width: size, height: size,
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: size * 0.043, padding: size * 0.152,
        borderRadius: size * 0.196,
        background: active || tumbling
          ? 'linear-gradient(150deg, #232329, #16161a)'
          : 'linear-gradient(150deg, #1a1a1e, #121215)',
        border: `1px solid ${active ? '#80ff49' : WILD_INK}`,
        boxShadow: tumbling ? '0 0 16px rgba(128,255,73,0.35)' : `0 0 10px ${WILD_GLOW}`,
        transform: tumbling ? 'rotate(8deg) scale(1.05)' : 'none',
        transition: 'transform 0.12s ease, box-shadow 0.2s ease',
      }}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const lit = (PIPS[value] ?? PIPS[1]).some(([r, c]) => r === row && c === col);
        return (
          <span
            key={i}
            style={{
              borderRadius: '50%',
              background: lit ? (active || tumbling ? '#80ff49' : WILD_INK) : 'transparent',
            }}
          />
        );
      })}
    </div>
  );
}
