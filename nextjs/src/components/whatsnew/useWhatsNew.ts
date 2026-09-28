// src/components/whatsnew/useWhatsNew.ts
//
// When the What's New dialog is on screen, and which releases it covers.
//
// One key, the last version this browser was shown. Three cases:
//
//   no key   — a first visit. There is nothing "new" to someone who has never
//              seen the old, and the app tour is about to open for them, so the
//              version is recorded and the dialog stays shut.
//   older    — a release (or several) landed since they last looked. Every
//              entry in between is shown, so skipping two releases skips none
//              of the notes, unless none of them has anything to say.
//   same     — already seen. Nothing happens until the next release.
//
// It can also be asked for from About. That goes through a window event, the
// same way the intro tours are requested from the sidebar, so the dialog lives
// once in the league layout rather than once per menu that links to it.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/appInfo';
import {
  compareVersions,
  isReleaseVersion,
  notesUpTo,
  unseenNotes,
  type ReleaseNote,
} from '@/lib/releaseNotes';

const EVENT = 'commissioner-suite:whats-new';
export const SEEN_KEY = 'whats_new_seen_version';

/** Storage throws in some private-browsing modes; release notes are never worth a crash. */
function readSeen(): string | null {
  try { return window.localStorage.getItem(SEEN_KEY); } catch { return null; }
}

function writeSeen(version: string): void {
  try { window.localStorage.setItem(SEEN_KEY, version); } catch { /* ignore */ }
}

/** Opens the dialog on request, e.g. from About. Shows every release so far. */
export function openWhatsNew(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export interface WhatsNewState {
  open: boolean;
  notes: ReleaseNote[];
  /** Records the running version as seen and closes. */
  close: () => void;
}

export function useWhatsNew(version: string = APP_VERSION): WhatsNewState {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);

  useEffect(() => {
    // A `dev` build has no place in the release history to compare against.
    if (!isReleaseVersion(version)) return;

    // Reading storage is the whole point of this effect, and the state it sets
    // cannot be derived during render without a hydration mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    const seen = readSeen();
    if (seen === null || !isReleaseVersion(seen)) {
      writeSeen(version);
      return;
    }
    if (compareVersions(seen, version) >= 0) return;

    const unseen = unseenNotes(seen, version);
    if (unseen.length === 0) {
      // Nothing a member would care about — move the marker on quietly.
      writeSeen(version);
      return;
    }
    setNotes(unseen);
    setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [version]);

  useEffect(() => {
    function onRequest() {
      setNotes(notesUpTo(version));
      setOpen(true);
    }
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, [version]);

  const close = useCallback(() => {
    setOpen(false);
    if (isReleaseVersion(version)) writeSeen(version);
  }, [version]);

  return { open, notes, close };
}
