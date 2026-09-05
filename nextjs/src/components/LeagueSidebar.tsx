'use client';

// src/components/LeagueSidebar.tsx
//
// The portal's nav on a tablet or a desktop: a collapsible rail down the left
// edge. Below `md` it takes itself out of the layout entirely and MobileNav's
// floating hamburger takes over — a 52px rail is a lot to give up on a phone,
// and a thumb reaches the bottom of the screen far more easily than the top
// left corner of it.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import { requestDraftDeckIntro } from '@/components/intro/DraftDeckIntro';
import { AboutDialog } from '@/components/AboutDialog';
import { useSidebarForceCollapseListener } from '@/components/useSidebarForceCollapse';
import { useLeagueNav, InfoIcon, SignOutIcon } from '@/components/leagueNav';

// ─── Tooltip shown beside collapsed nav icons ─────────────────────────────────

function NavTooltip({ label }: { label: string }) {
  return (
    <div
      className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1.5 rounded text-xs
                 whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100
                 transition-opacity duration-150 z-50"
      style={{ background: '#1e1e20', color: '#e8e6df', border: '1px solid #2a2a2c' }}
    >
      {label}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function LeagueSidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const [overflow, setOverflow] = useState<'hidden' | 'visible'>('hidden');
  // A page can ask this to collapse while it is on screen and the viewport is
  // narrow — the lineup tab does, since the sidebar's width there is the
  // difference between one card fitting the row and not. Kept separate from
  // `expanded` so the member's own preference is untouched underneath it.
  const [forcedCollapse, setForcedCollapse] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useSidebarForceCollapseListener(setForcedCollapse);
  const visible = forcedCollapse ? false : expanded;

  const { items: NAV, isAuthed } = useLeagueNav();

  // Default collapsed on mobile; respect saved preference otherwise
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_expanded');
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(saved === 'true');
    } else {
      setExpanded(window.innerWidth >= 768);
    }
  }, []);

  // Allow tooltips to extend outside the aside once the collapse animation
  // finishes. Keyed on `visible` rather than `expanded`, so a forced collapse
  // gets the same tooltip treatment as a member's own.
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverflow('hidden');
    } else {
      const t = setTimeout(() => setOverflow('visible'), 210);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // Stable so the dialog's Escape-key listener is not torn down and rebuilt on
  // every sidebar render.
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_expanded', String(next));
      return next;
    });
  }

  return (
    <>
    <aside
      className="isolate hidden md:flex flex-col shrink-0 border-r transition-[width] duration-200"
      style={{
        width: visible ? 216 : 52,
        background: '#0a0a0b',
        borderColor: '#1e1e20',
        overflow,
      }}
    >
      {/* ── Header / toggle ── */}
      <div
        className="flex items-center border-b px-3"
        style={{ borderColor: '#1e1e20', height: 56, gap: visible ? 8 : 0 }}
      >
        {visible && (
          <span
            className="flex-1 text-[10px] uppercase tracking-[0.2em] truncate"
            style={{ color: '#555' }}
          >
            Commissioner Suite
          </span>
        )}
        <button
          onClick={toggle}
          className="w-7 h-7 rounded flex items-center justify-center transition-colors shrink-0"
          style={{ color: '#555', marginLeft: visible ? 0 : 'auto', marginRight: visible ? 0 : 'auto' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          title={visible ? 'Collapse' : 'Expand'}
        >
          <ChevronIcon direction={visible ? 'left' : 'right'} />
        </button>
      </div>

      {/* ── Nav items ── */}
      <nav className="flex-1 flex flex-col gap-0.5 p-1.5 pt-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <div key={item.href} className="relative group">
              <Link
                href={item.href}
                // Draft Deck explains itself when you go there. The ask is made
                // before the navigation and picked up once the page mounts, so
                // it survives the route change; a member who ticked "Don't show
                // this again" is not re-asked.
                onClick={item.href === '/league/cards' ? requestDraftDeckIntro : undefined}
                className="flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors"
                style={{
                  background: active ? 'rgba(128,255,73,0.1)' : 'transparent',
                  color: active ? '#80ff49' : '#666',
                  minHeight: 36,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#e8e6df'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#666'; }}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  {item.icon}
                </span>
                {visible && <span className="truncate leading-none">{item.label}</span>}
              </Link>
              {!visible && <NavTooltip label={item.label} />}
            </div>
          );
        })}
      </nav>

      {/* ── Footer / about + sign out ── */}
      <div className="p-1.5 border-t flex flex-col gap-0.5" style={{ borderColor: '#1e1e20' }}>
        {/* Version and where to get help — useful to a signed-out visitor too,
            so this sits outside the signed-in-only sign out below. */}
        <div className="relative group">
          <button
            onClick={() => setAboutOpen(true)}
            className="flex items-center gap-3 w-full rounded px-2 py-2 text-sm transition-colors"
            style={{ color: '#555', minHeight: 36 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              <InfoIcon />
            </span>
            {visible && <span className="truncate">About</span>}
          </button>
          {!visible && <NavTooltip label="About" />}
        </div>

        {/* Signed-out visitors sign in from the dashboard header instead. */}
        {isAuthed && (
        <div className="relative group">
          {/* Signing out lands on the public dashboard, not the login page —
              Statistics and News are still readable without an account. */}
          <button
            onClick={() => void signOut({ callbackUrl: '/league/dashboard' })}
            className="flex items-center gap-3 w-full rounded px-2 py-2 text-sm transition-colors"
            style={{ color: '#555', minHeight: 36 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff4949')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              <SignOutIcon />
            </span>
            {visible && <span className="truncate">Sign out</span>}
          </button>
          {!visible && <NavTooltip label="Sign out" />}
        </div>
        )}
      </div>
    </aside>

    {/* Rendered outside the aside: the aside is its own stacking context, so a
        dialog nested inside it could be painted under the page content. */}
    <AboutDialog open={aboutOpen} onClose={closeAbout} />
    </>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────
//
// The nav's own icons live in leagueNav.tsx, shared with the mobile nav. This
// one is the rail's collapse control and has no second home.

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      {direction === 'left'
        ? <path d="M9 2L4 7l5 5" />
        : <path d="M5 2l5 5-5 5" />}
    </svg>
  );
}
