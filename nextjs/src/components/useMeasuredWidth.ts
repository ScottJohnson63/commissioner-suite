'use client';

// src/components/useMeasuredWidth.ts
//
// An element's own rendered content width, kept live.
//
// For anything sized in px rather than in CSS — PlayerCard chief among them,
// since its internal type scales off the `width` prop rather than off its own
// box — a fixed number is right where the box around it is also fixed, and
// wrong the moment that box's width depends on the viewport. This is the
// alternative: measure the box itself and feed that back in.

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * @param fallback Used for the first render, before the box has been
 *                 measured — and forever in a non-browser render.
 */
export function useMeasuredWidth<T extends HTMLElement>(
  fallback: number,
): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  // Layout rather than passive effect: reads the box's real width before the
  // browser paints, so the first frame is already sized instead of flashing
  // the fallback and then jumping.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    setWidth(Math.round(el.getBoundingClientRect().width));

    // jsdom (Jest's DOM) has no ResizeObserver — the initial measurement
    // above still runs there, it just never sees a change after that.
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
