// src/components/intro/useIntro.ts
//
// When an introduction carousel is on screen, and who decides.
//
// Three separate questions, which is why there are three keys rather than one
// "seen" flag:
//
//   seen   — the tour has run once, so it stops opening by itself.
//   muted  — the member ticked "Don't show this again", so it stops opening at
//            all unless they ask for it by name.
//   request— something asked for this tour from another page. The Draft Deck
//            tour lives on /league/cards but is triggered from the sidebar, and
//            the sidebar link navigates, so the ask has to survive a route
//            change. sessionStorage carries it; the window event covers the
//            case where the page is already mounted and never remounts.
//
// A "How it works" button passes force, which beats muted — asking for the
// tour explicitly should never be a no-op.

'use client';

import { useCallback, useEffect, useState } from 'react';

const EVENT = 'commissioner-suite:intro';

const seenKey  = (id: string) => `intro_seen_${id}`;
const mutedKey = (id: string) => `intro_muted_${id}`;
const reqKey   = (id: string) => `intro_request_${id}`;

/** Storage throws in some private-browsing modes; a tour is never worth a crash. */
function readLocal(key: string): boolean {
  try { return window.localStorage.getItem(key) === 'true'; } catch { return false; }
}

function writeLocal(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

function takeRequest(id: string): string | null {
  try {
    const value = window.sessionStorage.getItem(reqKey(id));
    window.sessionStorage.removeItem(reqKey(id));
    return value;
  } catch {
    return null;
  }
}

/**
 * Asks for a tour, whether or not its page is mounted yet.
 *
 * @param force Open even for a member who muted it — for an explicit
 *              "How it works" click, never for a passing navigation.
 */
export function requestIntro(id: string, force = false): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(reqKey(id), force ? 'force' : 'true'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, force } }));
}

export interface IntroState {
  open: boolean;
  muted: boolean;
  /** Marks the tour seen and closes it. */
  close: () => void;
  setMuted: (muted: boolean) => void;
}

/**
 * @param id   Storage-stable name for one tour, e.g. 'app' or 'cards'.
 * @param auto Whether a first visit opens it without being asked.
 */
export function useIntro(id: string, auto = true): IntroState {
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    // Reading storage is the whole point of this effect, and the state it sets
    // cannot be derived during render without a hydration mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    const isMuted = readLocal(mutedKey(id));
    setMutedState(isMuted);

    const request = takeRequest(id);
    if (request === 'force') { setOpen(true); return; }
    if (isMuted) return;
    if (request === 'true' || (auto && !readLocal(seenKey(id)))) setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [id, auto]);

  useEffect(() => {
    function onIntro(event: Event) {
      const detail = (event as CustomEvent<{ id: string; force: boolean }>).detail;
      if (detail?.id !== id) return;
      takeRequest(id);
      if (!detail.force && readLocal(mutedKey(id))) return;
      setOpen(true);
    }
    window.addEventListener(EVENT, onIntro);
    return () => window.removeEventListener(EVENT, onIntro);
  }, [id]);

  const close = useCallback(() => {
    setOpen(false);
    writeLocal(seenKey(id), true);
  }, [id]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeLocal(mutedKey(id), next);
  }, [id]);

  return { open, muted, close, setMuted };
}
