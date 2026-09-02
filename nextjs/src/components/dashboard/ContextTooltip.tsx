'use client';

import { useState, useId, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerContext } from '@/lib/matchupContext';

/**
 * The "why might this projection be wrong" popover.
 *
 * Everything here is context for a human decision, not an input to the numbers
 * beside it. Each factor states which way it pushes, because the directions are
 * not symmetric and are easy to get backwards — bad weather hurts an offense
 * and *helps* the defense standing in it.
 *
 * Opens on hover and on keyboard focus. Hover alone would leave the content
 * unreachable without a mouse, and the icon is the only thing announcing it.
 *
 * Rendered through a portal onto the body rather than inline. The player list
 * clips its rounded corners with `overflow: hidden`, and an inline popover is
 * invisible inside it — present in the DOM, painted nowhere.
 *
 * Only one is ever open. Hover closes itself on the way out, but a click on a
 * second icon would otherwise leave the first card up, so opening announces
 * itself and the others stand down.
 */

/** Fired when any card opens, carrying the id of the one that did. */
const OPEN_EVENT = 'matchup-context:open';

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Renders a stored kickoff as Eastern time.
 *
 * The stored value is already Eastern — nflverse publishes NFL kickoffs in ET,
 * which is why the slate lands on 13:00, 16:25 and 20:20, and why the London
 * games read 09:30. So this labels and formats; it must not convert.
 *
 * Deliberately not `new Date(...).toLocaleString()`: the string carries no zone,
 * so Date would read it as the *viewer's* local time and then shift it again —
 * showing a 1pm ET kickoff as 10am to someone in California. The parts are read
 * straight out of the string instead, and only the weekday is derived, from a
 * UTC date that cannot drift.
 */
export function formatKickoff(kickoff: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(kickoff);
  if (!m) return kickoff;

  const [, y, mo, d, hh, mm] = m;
  const weekday = DAYS[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  const month   = MONTHS[+mo - 1];

  const hour24 = +hh;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${weekday} ${+d} ${month} · ${hour12}:${mm} ${suffix} ET`;
}
export function ContextTooltip({
  context, position, playerName,
}: {
  context: PlayerContext;
  /** The player's position, which decides how each factor is worded. */
  position: string;
  playerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const WIDTH = 250;
  const ESTIMATED_HEIGHT = 300;

  /**
   * Pins the popover to the icon in viewport coordinates.
   *
   * Measured on open rather than tracked: the list does not scroll under the
   * popover while it is up, and a resize observer for a hover card is more
   * machinery than the problem deserves.
   */
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Flip below the icon when there is not room above it.
    const below = rect.top < ESTIMATED_HEIGHT + 12;
    // Keep the card on screen when the icon sits near an edge.
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - WIDTH / 2),
      window.innerWidth - WIDTH - 8,
    );
    setAnchor({
      left,
      top: below ? rect.bottom + 6 : rect.top - 6,
      below,
    });
  }, []);

  const hide = useCallback(() => setOpen(false), []);
  const show = useCallback(() => {
    place();
    setOpen(true);
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [place, id]);

  // Stand down when another card opens, and on Escape. Both only while open, so
  // a page of these adds no listeners until one is actually showing.
  useEffect(() => {
    if (!open) return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) hide();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, id, hide]);

  const isDefense  = position === 'DEF';
  const isKicker   = position === 'K';
  const wx         = context.weather;
  const rough      = wx ? wx.windMph > 20 || wx.precipPct > 60 || wx.tempF < 20 : false;

  return (
    <span
      className="relative shrink-0 inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Matchup context for ${playerName}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        className="rounded-full flex items-center justify-center text-[9px] leading-none transition-colors"
        style={{
          width: 14, height: 14,
          border: `1px solid ${rough ? '#facc15' : '#3a3a3d'}`,
          color: rough ? '#facc15' : '#6b6b6b',
          background: 'transparent',
        }}
      >
        i
      </button>

      {open && anchor && typeof document !== 'undefined' && createPortal(
        <span
          id={id}
          role="tooltip"
          className="flex flex-col gap-2 rounded-lg p-3 text-left"
          style={{
            position: 'fixed',
            left: anchor.left,
            top: anchor.below ? anchor.top : undefined,
            bottom: anchor.below ? undefined : window.innerHeight - anchor.top,
            zIndex: 60,
            width: WIDTH,
            background: '#0e0e0f',
            border: '1px solid #2a2a2c',
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {/* ── Fixture ─────────────────────────────────────────────── */}
          <span className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: '#555' }}>
              Fixture
            </span>
            <span className="text-[11px]" style={{ color: '#e8e6df' }}>
              {context.opponent
                ? `${context.home ? 'vs' : '@'} ${context.opponent}`
                : 'No game found'}
            </span>
            {context.kickoff && (
              <span className="text-[10px]" style={{ color: '#6b6b6b' }}>
                {formatKickoff(context.kickoff)}
              </span>
            )}
            {context.stadium && (
              <span className="text-[10px]" style={{ color: '#6b6b6b' }}>{context.stadium}</span>
            )}
          </span>

          {/* ── Weather ─────────────────────────────────────────────── */}
          <span className="flex flex-col gap-0.5">
            {/* The readings sit on the label's own line: they are the thing
                being looked up, and the sentence beneath is the gloss on it. */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[9px] uppercase tracking-wider shrink-0" style={{ color: '#555' }}>
                Conditions
              </span>
              {wx && (
                <span className="text-[10px] tabular-nums text-right"
                  style={{ color: rough ? '#facc15' : '#e8e6df' }}>
                  {wx.tempF}°F · {wx.windMph}mph · {wx.precipPct}% rain
                </span>
              )}
            </span>
            {wx ? (
              <span className="text-[10px] leading-snug" style={{ color: '#6b6b6b' }}>
                {rough
                  ? (isDefense
                      ? 'Rough conditions favour this defense — offenses throw and kick worse in it.'
                      : isKicker
                        ? 'Rough conditions hurt kickers most; wind moves a long attempt more than a short one.'
                        : 'Rough conditions suppress passing and scoring, and the defense opposite benefits.')
                  : 'Clear enough that conditions should not move this either way.'}
              </span>
            ) : (
              <span className="text-[10px] leading-snug" style={{ color: '#6b6b6b' }}>
                {context.weatherNote ?? 'No forecast.'}
              </span>
            )}
          </span>

          {/* ── Opposing unit ───────────────────────────────────────── */}
          <span className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: '#555' }}>
              {isDefense ? 'Offense faced' : 'Defense faced'}
            </span>
            {context.opposing ? (
              <>
                <span className="text-[11px] tabular-nums" style={{ color: '#e8e6df' }}>
                  {context.opposing.team} · {context.opposing.tier} ·{' '}
                  #{context.opposing.rank} of {context.opposing.of}
                  <span style={{ color: '#6b6b6b' }}> · {context.opposing.perGame}/gm</span>
                </span>
                <span className="text-[10px] leading-snug" style={{ color: '#6b6b6b' }}>
                  {isDefense
                    ? 'A stronger offense here means fewer points for this defense.'
                    : `A stronger defense here means fewer points for a ${position}.`}
                </span>
              </>
            ) : (
              <span className="text-[10px]" style={{ color: '#6b6b6b' }}>
                Not enough data on the opposing unit.
              </span>
            )}
          </span>

          {/* ── Betting line ────────────────────────────────────────── */}
          <span className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: '#555' }}>
              Line
            </span>
            {context.line ? (
              <>
                <span className="text-[11px] tabular-nums" style={{ color: '#e8e6df' }}>
                  O/U {context.line.total} · {context.line.homeTeam.split(' ').at(-1)}{' '}
                  {context.line.spread > 0 ? '+' : ''}{context.line.spread}
                </span>
                <span className="text-[10px] leading-snug" style={{ color: '#6b6b6b' }}>
                  A high total points to a shootout, which lifts both offenses and
                  hurts both defenses.
                </span>
              </>
            ) : (
              <span className="text-[10px]" style={{ color: '#6b6b6b' }}>
                No line for this game.
              </span>
            )}
          </span>

          <span className="text-[9px] leading-snug pt-1"
            style={{ color: '#4a4a4a', borderTop: '1px solid #1e1e20' }}>
            Context only — none of this is applied to the projection.
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}
