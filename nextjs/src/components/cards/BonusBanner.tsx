'use client';

// src/components/cards/BonusBanner.tsx
//
// What your Sleeper week earned you.
//
// The bonus packs are the one part of the game driven by something that
// happened somewhere else, so they have to explain themselves — a pack that
// silently appears is indistinguishable from a bug. This says which rule fired
// and, where Sleeper gave us one, the score that did it.

import type { BonusStateDto } from '@/types/cards';

const RULE_LABEL: Record<string, string> = {
  WIN: 'Won your matchup',
  HIGH_SCORE: 'Broke the score line',
};

export function BonusBanner({
  bonus, remaining,
}: {
  bonus: BonusStateDto;
  /** Bonus packs earned this week and not yet opened. */
  remaining: number;
}) {
  const earned = bonus.kinds.length;

  // Nothing earned and nothing pending — say what is on offer instead, so the
  // rules are visible before they fire rather than only after.
  if (!earned) {
    return (
      <div
        className="rounded px-3 py-2 text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1"
        style={{ background: '#0e0e0f', border: '1px solid #1e1e20', color: '#555' }}
      >
        <span className="uppercase font-bold" style={{ letterSpacing: '0.16em', color: '#444' }}>
          Sleeper bonus
        </span>
        <span>Win a matchup, or score over {bonus.threshold}, for an extra pack.</span>
        <span style={{ color: '#3a3a3a' }}>One of each a week, however many leagues you play.</span>
      </div>
    );
  }

  return (
    <div
      className="rounded px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5"
      style={{
        background: 'rgba(128,255,73,0.07)',
        border: '1px solid rgba(128,255,73,0.28)',
      }}
    >
      <span
        className="text-[10px] uppercase font-bold"
        style={{ letterSpacing: '0.16em', color: '#80ff49' }}
      >
        Sleeper bonus
      </span>

      {bonus.kinds.map((kind) => {
        // Prefer the award from this request, which carries the score; fall
        // back to the bare rule for one earned on an earlier visit.
        const detail = bonus.awarded.find((a) => a.kind === kind);
        return (
          <span key={kind} className="text-[11px]" style={{ color: '#e8e6df' }}>
            {RULE_LABEL[kind] ?? kind}
            {detail?.points != null && (
              <span style={{ color: '#80ff49' }}> · {detail.points.toFixed(1)} pts</span>
            )}
          </span>
        );
      })}

      <span className="text-[11px] ml-auto" style={{ color: remaining ? '#80ff49' : '#555' }}>
        {remaining > 0
          ? `${remaining} bonus pack${remaining === 1 ? '' : 's'} waiting`
          : 'All bonus packs opened'}
      </span>
    </div>
  );
}
