'use client';

// src/components/MobileNav.tsx
//
// The portal's nav on a phone: a floating hamburger pinned to the bottom of
// the viewport that opens the destinations in a sheet above itself.
//
// It replaces the left rail below `md` rather than sitting alongside it — the
// rail costs 52px of an already narrow screen, and its toggle sits in the one
// corner a thumb cannot reach. The bottom right corner is the one it reaches
// most easily instead. The button floats over the page rather than docking to
// the edge so the content behind it still reads as a full page; the layout
// leaves room underneath the scroll area so it never covers the last row of
// anything.
//
// Everything it lists comes from leagueNav, the same source the rail reads, so
// the two cannot disagree about who may see what.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { signOut } from 'next-auth/react';
import { requestDraftDeckIntro } from '@/components/intro/DraftDeckIntro';
import { AboutDialog } from '@/components/AboutDialog';
import { useLeagueNav, InfoIcon, SignOutIcon } from '@/components/leagueNav';

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { items: NAV, isAuthed } = useLeagueNav();

  // The sheet's own opening animation. Mounting it and flipping this on the
  // next frame is what gives the transition something to animate from.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(false);
      return undefined;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // A tap on a destination navigates and the sheet should be gone when the new
  // page paints — closing on the pathname change covers the browser's own back
  // button as well as the links in here.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOpen(false);
  }, [pathname]);

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const closeAbout = useCallback(() => setAboutOpen(false), []);

  return (
    <>
      {/* Everything here is out of the layout flow and hidden from `md` up,
          where the rail takes over. */}
      <div className="md:hidden">
        {/* ── Scrim ──
            Dims the page behind the sheet and takes the tap that closes it. */}
        {open && (
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 transition-opacity duration-200"
            style={{
              background: 'rgba(10,10,11,0.6)',
              backdropFilter: 'blur(2px)',
              opacity: shown ? 1 : 0,
            }}
          />
        )}

        {/* ── Sheet ──
            Sits directly above the button, sharing its right edge, and grows up
            and to the left from there — anchored to what was tapped rather than
            spanning a width that has nothing to do with it. Capped at the
            viewport in both directions, so a commissioner's longer nav scrolls
            rather than running off the top of a small screen and a long label
            cannot push it off the left of one. */}
        {open && (
          <nav
            id="mobile-nav-menu"
            className="fixed z-50 rounded-2xl overflow-y-auto p-1.5
                       flex flex-col gap-0.5 transition-all duration-200"
            style={{
              right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
              minWidth: 220,
              maxWidth: 'calc(100vw - env(safe-area-inset-right, 0px) - 32px)',
              maxHeight: 'calc(100dvh - env(safe-area-inset-bottom, 0px) - 120px)',
              background: 'rgba(14,14,15,0.92)',
              backdropFilter: 'blur(12px)',
              border: '1px solid #2a2a2c',
              boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
              opacity: shown ? 1 : 0,
              transform: shown ? 'translateY(0)' : 'translateY(8px)',
            }}
          >
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // Same hand-off as the rail: Draft Deck asks for its tour
                  // before the navigation and the page picks it up on mount.
                  onClick={item.href === '/league/cards' ? requestDraftDeckIntro : undefined}
                  className="flex items-center gap-3 rounded-xl px-3 text-sm transition-colors"
                  style={{
                    background: active ? 'rgba(128,255,73,0.1)' : 'transparent',
                    color: active ? '#80ff49' : '#b4b2ac',
                    minHeight: 46,
                  }}
                >
                  <span className="w-5 h-5 flex items-center justify-center shrink-0">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}

            <div className="my-1 h-px shrink-0" style={{ background: '#1e1e20' }} />

            {/* Version and where to get help — useful signed out too, so it
                sits outside the signed-in-only sign out below. */}
            <button
              onClick={() => { setOpen(false); setAboutOpen(true); }}
              className="flex items-center gap-3 w-full rounded-xl px-3 text-sm"
              style={{ color: '#8a8a86', minHeight: 46 }}
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                <InfoIcon />
              </span>
              <span className="truncate">About</span>
            </button>

            {/* Signing out lands on the public dashboard, not the login page —
                Statistics and News are still readable without an account. */}
            {isAuthed && (
              <button
                onClick={() => void signOut({ callbackUrl: '/league/dashboard' })}
                className="flex items-center gap-3 w-full rounded-xl px-3 text-sm"
                style={{ color: '#ff6b6b', minHeight: 46 }}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  <SignOutIcon />
                </span>
                <span className="truncate">Sign out</span>
              </button>
            )}
          </nav>
        )}

        {/* ── The button itself ── */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav-menu"
          className="fixed z-50 flex items-center justify-center rounded-full transition-colors"
          style={{
            right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            width: 52,
            height: 52,
            background: 'rgba(20,20,21,0.92)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${open ? '#80ff49' : '#2a2a2c'}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            color: open ? '#80ff49' : '#e8e6df',
          }}
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {/* Outside the md:hidden wrapper is unnecessary — the dialog only ever
          opens from the button above — but it is kept a sibling of the sheet so
          it is never nested inside a fixed, blurred element, which would make
          its own overlay paint inside that box. */}
      <AboutDialog open={aboutOpen} onClose={closeAbout} />
    </>
  );
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

/** Three bars that fold into a cross while the sheet is open. */
function MenuIcon({ open }: { open: boolean }) {
  const bar = 'transition-transform duration-200 origin-center';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path
        className={bar}
        d="M2 5h14"
        style={{ transform: open ? 'translateY(4px) rotate(45deg)' : undefined }}
      />
      <path
        d="M2 9h14"
        style={{ opacity: open ? 0 : 1, transition: 'opacity 0.15s' }}
      />
      <path
        className={bar}
        d="M2 13h14"
        style={{ transform: open ? 'translateY(-4px) rotate(-45deg)' : undefined }}
      />
    </svg>
  );
}
