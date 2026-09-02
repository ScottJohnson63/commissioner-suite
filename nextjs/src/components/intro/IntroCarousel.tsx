// src/components/intro/IntroCarousel.tsx
//
// The frame every introduction tour is drawn in: one slide at a time, dots,
// Back/Next, and a way out at every step.
//
// It knows nothing about what it is explaining — the app tour and the Draft
// Deck tour are both just arrays of slides — so a third tour costs a slide
// array and nothing else.
//
// The chrome copies the dashboard's: #141415 panels on #0e0e0f, the #80ff49
// accent for the one action that moves you forward, and #555 for everything
// that does not.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface IntroSlide {
  /** Stable key, also used as the dot's accessible name. */
  key: string;
  /** Small label above the title — usually where in the app this lives. */
  eyebrow: string;
  title: string;
  /** The explanation. A node rather than a string so a slide can list things. */
  body: React.ReactNode;
  /** Optional artwork, drawn in the panel above the title. */
  art?: React.ReactNode;
  /** Optional call to action rendered beside Back/Next on that slide. */
  action?: { label: string; onClick: () => void };
}

export function IntroCarousel({
  slides, open, onClose, muted, onMuted, doneLabel = 'Got it',
}: {
  slides: IntroSlide[];
  open: boolean;
  /** Closing always means "seen" — see useIntro. */
  onClose: () => void;
  muted: boolean;
  onMuted: (muted: boolean) => void;
  doneLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const last = slides.length - 1;
  const atEnd = index >= last;

  const goNext = useCallback(() => {
    setIndex((i) => (i >= slides.length - 1 ? i : i + 1));
  }, [slides.length]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Reopening starts from the top — a tour resumed halfway through reads as a
  // bug, and there is no progress here worth preserving.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setIndex(0);
  }, [open]);

  // Escape leaves, arrows page. The dialog owns the keyboard while it is up.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')     { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, goNext, goBack]);

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => { if (open) nextRef.current?.focus(); }, [open]);

  if (!open || slides.length === 0) return null;

  const slide = slides[Math.min(index, last)];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: '#141415', border: '1px solid #2a2a2c', maxHeight: '92vh' }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: '#1e1e20' }}
        >
          <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: '#555' }}>
            {slide.eyebrow}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] tabular-nums" style={{ color: '#444' }}>
              {`${index + 1} / ${slides.length}`}
            </span>
            <button
              onClick={onClose}
              aria-label="Close introduction"
              className="w-6 h-6 rounded flex items-center justify-center transition-colors"
              style={{ color: '#555' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M1 1l9 9M10 1l-9 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Slide ── */}
        <div className="px-5 py-6 overflow-y-auto" style={{ color: '#e8e6df' }}>
          {slide.art && (
            <div
              className="rounded-xl mb-5 flex items-center justify-center"
              style={{ background: '#0e0e0f', border: '1px solid #1e1e20', minHeight: 120 }}
            >
              {slide.art}
            </div>
          )}
          <h2 id="intro-title" className="text-lg font-semibold mb-2">{slide.title}</h2>
          <div className="text-[13px] leading-relaxed" style={{ color: '#9a9a94' }}>
            {slide.body}
          </div>
        </div>

        {/* ── Dots ── */}
        <div className="flex items-center justify-center gap-1.5 pb-3 shrink-0">
          {slides.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setIndex(i)}
              aria-label={`Go to ${s.title}`}
              aria-current={i === index}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                background: i === index ? '#80ff49' : '#2a2a2c',
              }}
            />
          ))}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center gap-3 px-5 py-3 border-t shrink-0"
          style={{ borderColor: '#1e1e20' }}
        >
          <label className="flex items-center gap-2 text-[11px] cursor-pointer mr-auto"
            style={{ color: '#555' }}>
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => onMuted(e.target.checked)}
              style={{ accentColor: '#80ff49' }}
            />
            Don&apos;t show this again
          </label>

          {index > 0 && (
            <button
              onClick={goBack}
              className="text-xs font-medium px-3 py-1.5 rounded transition-colors"
              style={{ color: '#888', border: '1px solid #2a2a2c' }}
            >
              Back
            </button>
          )}

          {slide.action && (
            <button
              onClick={slide.action.onClick}
              className="text-xs font-medium px-3 py-1.5 rounded transition-colors"
              style={{ color: '#80ff49', border: '1px solid rgba(128,255,73,0.35)' }}
            >
              {slide.action.label}
            </button>
          )}

          <button
            ref={nextRef}
            onClick={atEnd ? onClose : goNext}
            className="text-xs font-medium px-4 py-1.5 rounded transition-opacity hover:opacity-85"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
          >
            {atEnd ? doneLabel : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bulleted body copy, so every slide's list looks the same. */
export function IntroList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 mt-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="shrink-0 mt-[7px] rounded-full"
            style={{ width: 4, height: 4, background: '#80ff49' }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** The accent-coloured lead-in used inside list items. */
export function IntroTerm({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: '#e8e6df', fontWeight: 600 }}>{children}</strong>;
}
