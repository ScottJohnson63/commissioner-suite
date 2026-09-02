'use client';

// src/components/cards/CardsDialog.tsx
//
// The dialog chrome shared by the Packs and Deck tabs: a dark overlay and a
// centered panel that slides up from the bottom on a phone, the same frame
// IntroCarousel uses for the game's own tour. Reusing it here rather than
// inventing a second dialog look is what makes both feel like the same app.
//
// Deliberately just the chrome — a title, a close control, a scrollable body.
// Neither caller needs the slide-dots or the Back/Next footer that the intro
// carousel has, so this is the frame without them rather than that component
// with everything else hidden.
//
// `open` toggles CSS visibility rather than gating a conditional render, so the
// dialog's children stay mounted while it is closed. That matters for the
// packs dialog in particular: a pack mid-reveal holds state (which card is
// turned, whether a wildcard has been thrown) that a stray tap outside the
// dialog should not throw away — see the note on PackOpener staying mounted
// across tab switches, which this preserves rather than undoes.

import { useEffect } from 'react';

export function CardsDialog({
  open, title, onClose, widthClassName = 'sm:max-w-lg', children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Tailwind max-width class for the panel on sm+ screens. */
  widthClassName?: string;
  children: React.ReactNode;
}) {
  // Escape leaves, and the page behind a modal should not scroll under it —
  // both copied from IntroCarousel so every dialog in the app behaves alike.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ display: open ? 'flex' : 'none', background: 'rgba(0,0,0,0.72)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cards-dialog-title"
        className={`w-full ${widthClassName} rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col`}
        style={{ background: '#141415', border: '1px solid #2a2a2c', maxHeight: '92vh' }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: '#1e1e20' }}
        >
          <span
            id="cards-dialog-title"
            className="text-[10px] uppercase tracking-[0.2em]"
            style={{ color: '#555' }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
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

        {/* ── Body ── */}
        <div className="px-5 py-6 overflow-y-auto" style={{ color: '#e8e6df' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
