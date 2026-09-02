'use client';

// src/components/cards/WeeklyPanel.tsx
//
// The week's deadline, and the button that meets it.
//
// Draft Deck is played a week at a time: set a lineup, submit it before Monday
// 11:59pm central, and read the results on Tuesday morning. This is the part of
// the lineup tab that says which of those three things is happening now.
//
// Two things it has to get right, because both are ways of losing a week.
//
// **The deadline has to be legible in the reader's own head.** So it is stated
// twice — as central time, which is the rule as written, and as a countdown,
// which is the only form that answers "have I got time to think about it". A
// member in Los Angeles should not have to do the arithmetic.
//
// **Submitting is a save, not a send.** The lineup stays editable until the
// deadline, so a member who submits and then swaps a card has a submission that
// no longer matches what they are looking at. That is flagged loudly rather
// than fixed silently: auto-resubmitting on every swap would mean a mis-click
// at 11:58pm is final, and doing nothing would mean the lineup on screen is not
// the one that plays.

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { RosterSlotDto, WeeklyStateDto } from '@/types/cards';

/** Colour per phase, so the panel reads before it is read. */
const PHASE_STYLE = {
  OPEN:     { edge: '#80ff49', label: 'Open' },
  LOCKED:   { edge: '#ffb347', label: 'Locked' },
  REVEALED: { edge: '#8a8a92', label: 'Published' },
} as const;

/**
 * "2d 4h 11m", or "1m" in the last hour.
 *
 * Coarse on purpose above an hour — a member with two days left does not need
 * seconds, and a panel whose every character changes each second is hard to
 * read past. Under a minute it counts seconds, because at that point that is
 * the only number that matters.
 */
function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds % 60}s`;
}

/**
 * A ticking clock, and null until the component has mounted.
 *
 * The wall clock is an external system that changes on its own, which is
 * exactly what `useSyncExternalStore` is for — an effect that called setState
 * on mount would be a cascading render, and the linter is right about that.
 *
 * Null first is what keeps the server's render and the browser's first render
 * identical: a countdown computed during SSR is stale by the time it reaches
 * the page, and React calls that a hydration error rather than a rounding one.
 * The server snapshot is null and so is the ref, so the two agree; the
 * subscription then fills it in.
 *
 * The reading lives in a ref rather than being returned fresh from
 * `getSnapshot`, because a snapshot that differs on every call is one React
 * re-reads forever.
 */
function useNow(): number | null {
  const reading = useRef<number | null>(null);

  const subscribe = useCallback((onChange: () => void) => {
    const tick = () => {
      reading.current = Date.now();
      onChange();
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, []);

  return useSyncExternalStore(subscribe, () => reading.current, () => null);
}

/**
 * Whether the lineup on screen is the one that was submitted.
 *
 * Compared slot by slot rather than by counting: swapping one running back for
 * another leaves the same nine slots filled and is exactly the change a member
 * needs telling about.
 */
function matchesSubmission(roster: RosterSlotDto[], weekly: WeeklyStateDto): boolean {
  if (!weekly.submitted) return false;

  const submitted = new Map(weekly.submitted.slots.map((s) => [s.slot, s.cardId]));
  const current = roster.filter((s) => s.card);
  if (current.length !== submitted.size) return false;
  return current.every((slot) => submitted.get(slot.id) === slot.card?.id);
}

export function WeeklyPanel({
  weekly, roster, onSubmit,
}: {
  weekly: WeeklyStateDto;
  /** The working lineup, so an edited submission can be flagged. */
  roster: RosterSlotDto[];
  /** Freezes the lineup. Rejects with a readable message. */
  onSubmit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const phase = PHASE_STYLE[weekly.phase];
  const filled = roster.filter((s) => s.card).length;
  const points = roster.reduce((sum, s) => sum + (s.card?.pointsPerGame ?? 0), 0);
  const inSync = matchesSubmission(roster, weekly);
  const deadline = new Date(weekly.phase === 'OPEN' ? weekly.lockAt : weekly.revealAt).getTime();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your lineup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded" style={{ background: '#0e0e0f', border: `1px solid ${phase.edge}44` }}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
        style={{ borderBottom: '1px solid #1e1e20' }}
      >
        <span className="text-[11px] font-bold" style={{ color: '#e8e6df' }}>
          Week {weekly.week}
        </span>
        <span
          className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded"
          style={{ letterSpacing: '0.14em', color: phase.edge, border: `1px solid ${phase.edge}55` }}
        >
          {phase.label}
        </span>

        {/* The season total, which is what the whole thing is played for. */}
        <span className="text-[10px] ml-auto" style={{ color: '#555' }}>
          Season
          <span className="ml-1.5 font-bold tabular-nums" style={{ color: '#e8e6df' }}>
            {weekly.seasonPoints.toFixed(1)}
          </span>
          <span className="ml-1">
            {weekly.weeksPlayed === 1 ? 'over 1 week' : `over ${weekly.weeksPlayed} weeks`}
          </span>
        </span>
      </div>

      <div className="px-3 py-3 flex flex-col gap-3">
        {weekly.seasonOver ? (
          <p className="text-[11px]" style={{ color: '#8a8a92' }}>
            The season is over — every week has been played and the standings are final.
          </p>
        ) : weekly.phase === 'LOCKED' ? (
          <p className="text-[11px]" style={{ color: '#ffb347' }}>
            Lineups are locked. Week {weekly.week}&apos;s results are published{' '}
            <strong>{weekly.revealLabel}</strong>
            {now !== null && <> — {countdown(deadline - now)} away.</>}
          </p>
        ) : (
          <>
            <p className="text-[11px]" style={{ color: '#bdbcb4' }}>
              Submit by <strong style={{ color: '#e8e6df' }}>{weekly.lockLabel}</strong>
              {now !== null && (
                <>
                  {' '}—{' '}
                  <strong style={{ color: deadline - now < 86_400_000 ? '#ffb347' : '#80ff49' }}>
                    {countdown(deadline - now)}
                  </strong>{' '}
                  left.
                </>
              )}{' '}
              Results {weekly.revealLabel}.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void submit()}
                disabled={busy || filled === 0 || (Boolean(weekly.submitted) && inSync)}
                className="px-3 py-1.5 text-[11px] font-bold uppercase rounded transition-colors disabled:cursor-default"
                style={{
                  letterSpacing: '0.12em',
                  background: busy || filled === 0 || (weekly.submitted && inSync)
                    ? '#141416'
                    : 'rgba(128,255,73,0.12)',
                  border: `1px solid ${
                    busy || filled === 0 || (weekly.submitted && inSync) ? '#1e1e20' : '#80ff49'
                  }`,
                  color: busy || filled === 0 || (weekly.submitted && inSync) ? '#555' : '#80ff49',
                }}
              >
                {busy
                  ? 'Submitting…'
                  : weekly.submitted
                    ? inSync ? 'Submitted' : 'Update submission'
                    : 'Submit lineup'}
              </button>

              <span className="text-[10px]" style={{ color: '#555' }}>
                {filled} card{filled === 1 ? '' : 's'} · {points.toFixed(1)} pts
              </span>
            </div>

            {/* Submitted, then edited. Loud, because the lineup on screen is
                not the one that plays until this is pressed again. */}
            {weekly.submitted && !inSync && (
              <p className="text-[11px]" style={{ color: '#ffb347' }}>
                Your lineup has changed since you submitted{' '}
                {weekly.submitted.points.toFixed(1)} points. Update it or last submission
                stands.
              </p>
            )}
            {weekly.submitted && inSync && (
              <p className="text-[11px]" style={{ color: '#555' }}>
                Submitted for {weekly.submitted.points.toFixed(1)} points. You can keep
                editing until the deadline.
              </p>
            )}
            {!weekly.submitted && filled === 0 && (
              <p className="text-[11px]" style={{ color: '#555' }}>
                Fill a slot below to submit. A week you do not submit scores nothing.
              </p>
            )}
          </>
        )}

        {/* The rule that makes the whole thing a decision rather than a form. */}
        <p className="text-[10px]" style={{ color: '#444' }}>
          Every card you play is retired for the season — {weekly.retired} used so far.
        </p>

        {error && <p className="text-[11px]" style={{ color: '#ff6b6b' }}>{error}</p>}
      </div>
    </div>
  );
}
