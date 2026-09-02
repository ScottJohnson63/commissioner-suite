'use client';

// src/components/useSidebarForceCollapse.ts
//
// Lets a page ask the league sidebar to collapse itself while that page is on
// screen and the viewport is narrow — the lineup tab is the first user of
// this, where the sidebar's own width is the difference between one card
// fitting the row and not.
//
// A window event rather than React context, matching how useIntro coordinates
// the tour across the sidebar and the page it navigates to: the sidebar and
// the page requesting the collapse are siblings under the league layout, and
// an event needs nothing threaded through the tree between them.
//
// The request only ever says "collapse" or "stop asking" — it never asks the
// sidebar to expand. A member who pinned it open on a wide screen and then
// shrinks the window keeps whatever they last chose; this only narrows it
// further while it is active, and gives that back on its own unmount.

import { useEffect } from 'react';

const EVENT = 'commissioner-suite:sidebar-force-collapse';

function emit(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: active }));
}

/** The sidebar's own side of this — one listener, updated on every request. */
export function useSidebarForceCollapseListener(onChange: (active: boolean) => void): void {
  useEffect(() => {
    function onEvent(e: Event) {
      onChange(Boolean((e as CustomEvent<boolean>).detail));
    }
    window.addEventListener(EVENT, onEvent);
    return () => window.removeEventListener(EVENT, onEvent);
  }, [onChange]);
}

/**
 * Forces the sidebar collapsed while `active` is true and the viewport is at
 * most `maxWidthPx` wide. Tracks the media query live, so rotating the phone
 * or resizing a browser window updates it without a remount, and always
 * releases the request on the way out — an unmount or `active` turning false
 * both give the sidebar back to whatever the member had it set to.
 */
export function useForceSidebarCollapsed(active: boolean, maxWidthPx = 767): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;

    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const apply = () => emit(mql.matches);
    apply();
    mql.addEventListener('change', apply);

    return () => {
      mql.removeEventListener('change', apply);
      emit(false);
    };
  }, [active, maxWidthPx]);
}
