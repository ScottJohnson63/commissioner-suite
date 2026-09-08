'use client';

// src/components/ai/useChatViewport.ts
//
// What a chat needs from a phone that a scrollable page does not.
//
// Two problems, both invisible on a desktop browser and both obvious the moment
// a thumb is involved.
//
// The bottom of the screen. The portal's scroll pane leaves a band at the
// bottom for the floating nav button to hover in, which is right for a page of
// rows and wrong for a chat: it parks the composer 96px up with an empty strip
// underneath. This claims that band back and tells the button how far to step
// up, so the composer sits where a composer sits.
//
// The keyboard. `100dvh` is the viewport with the browser's toolbars accounted
// for — it says nothing about a keyboard, so on iOS the composer ends up
// underneath one and the page scrolls around trying to compensate. The visual
// viewport is the only thing that actually knows, so the column is shortened by
// however much of it is covered.

import { useEffect, useRef } from 'react';

/** Root-level custom properties this hook owns while the chat is mounted. */
const MAIN_PAD = '--app-main-pad-bottom';
const BAR_HEIGHT = '--app-bottom-bar-height';

/**
 * Claims the bottom of the screen for a chat column.
 *
 * @param barRef  The page's own bottom bar — the composer. Its height is
 *                published so the floating nav button can clear it.
 * @returns       A ref for the chat column, whose height is kept clear of the
 *                software keyboard.
 */
export function useChatViewport(
  barRef: React.RefObject<HTMLElement | null>,
): React.RefObject<HTMLElement | null> {
  const columnRef = useRef<HTMLElement | null>(null);

  // ── The bottom band ───────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(MAIN_PAD, '0px');

    // The button clears the composer, so it has to know how tall it is — and
    // the composer grows as the textarea does.
    const bar = barRef.current;
    const publish = () => {
      const height = bar?.offsetHeight ?? 0;
      root.style.setProperty(BAR_HEIGHT, `${height}px`);
    };
    publish();

    const observer = bar && 'ResizeObserver' in window ? new ResizeObserver(publish) : null;
    if (bar && observer) observer.observe(bar);

    return () => {
      // Every other page wants the band back.
      observer?.disconnect();
      root.style.removeProperty(MAIN_PAD);
      root.style.removeProperty(BAR_HEIGHT);
    };
  }, [barRef]);

  // ── The keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    const column = columnRef.current;
    if (!vv || !column) return undefined;

    const apply = () => {
      // What the keyboard is covering: the gap between the layout viewport and
      // the part of it still visible. Rounded down and floored at zero, because
      // sub-pixel noise here reads as a column that will not sit still.
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      column.style.setProperty('--kb-inset', `${covered}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, []);

  return columnRef;
}
