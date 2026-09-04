'use client';

// src/components/leagueNav.tsx
//
// The one list of portal destinations, plus the icons that go with them.
//
// It lives apart from the sidebar because there are now two navs drawing from
// it: the rail on desktop and the floating hamburger on a phone. Keeping the
// entries here means a new page is added once, and the two navs cannot drift
// apart on who is allowed to see what.

import React from 'react';
import { useSession } from 'next-auth/react';
import type { Route } from 'next';

export interface NavItem {
  label: string;
  href: Route;
  icon: React.ReactNode;
}

// Route type satisfies Next.js typedRoutes — href must be a known app route.
// Dashboard is the only entry a signed-out visitor can reach — the page itself
// shows them just the public Statistics and News tabs.
const PUBLIC_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/league/dashboard', icon: <GridIcon /> },
];

const AUTHED_NAV: NavItem[] = [
  { label: 'AI Assistant', href: '/league/ai', icon: <SparkleIcon /> },
  // Any signed-in account can collect, PLAYER included — the card game is the
  // one feature that is not about running the league.
  { label: 'Draft Deck', href: '/league/cards', icon: <CardsIcon /> },
];

// League Sync, Stats Sync, Members and Activity Log are member-only; a PLAYER
// sees just the base nav.
const MEMBER_NAV: NavItem[] = [
  { label: 'League Sync',  href: '/league/league-sync', icon: <SyncIcon />   },
  { label: 'Stats Sync',   href: '/league/stats-sync',  icon: <StatsIcon />  },
  { label: 'Members',      href: '/league/members',     icon: <PeopleIcon /> },
  { label: 'Activity Log', href: '/league/log',         icon: <LogIcon />    },
];

/**
 * The nav entries this visitor may see, with the two role flags both navs need
 * for the rest of their chrome (the sign out button is signed-in only).
 */
export function useLeagueNav(): { items: NavItem[]; isAuthed: boolean; isMember: boolean } {
  const { data: session, status } = useSession();

  const isAuthed = status === 'authenticated';
  const isMember =
    session?.user?.role === 'MEMBER' || session?.user?.role === 'COMMISSIONER';

  const items: NavItem[] = [
    ...PUBLIC_NAV,
    ...(isAuthed ? AUTHED_NAV : []),
    ...(isMember ? MEMBER_NAV : []),
  ];

  return { items, isAuthed, isMember };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

export function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M3.05 3.05l1.42 1.42M10.53 10.53l1.42 1.42M10.53 4.47l1.42-1.42M3.05 11.95l1.42-1.42" />
      <circle cx="7.5" cy="7.5" r="2.5" />
    </svg>
  );
}

export function CardsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5" y="2.5" width="8" height="10.5" rx="1.5" />
      <path d="M3.6 4.2 2.2 4.6a1.5 1.5 0 0 0-1.05 1.84l1.6 5.9" strokeLinecap="round" />
    </svg>
  );
}

export function StatsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 13V9M6 13V4M10 13V7M14 13V2" strokeLinecap="round" />
    </svg>
  );
}

export function SyncIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M13 7.5a5.5 5.5 0 01-9.4 3.9M2 7.5a5.5 5.5 0 019.4-3.9" />
      <path d="M11.5 1v3h-3M3.5 14v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="5.5" cy="4.5" r="2" />
      <path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <circle cx="11" cy="4.5" r="1.5" />
      <path d="M11 9.5c1.5.3 3 1.3 3 3.5" />
    </svg>
  );
}

export function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6 2.5H3a1 1 0 00-1 1v8a1 1 0 001 1h3M10 11l3-3.5L10 4M13 7.5H6" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7.5" cy="7.5" r="6" />
      <path d="M7.5 6.8v4" strokeLinecap="round" />
      <circle cx="7.5" cy="4.6" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="1.5" width="11" height="12" rx="1.5" />
      <path d="M5 5h5M5 7.5h5M5 10h3" />
    </svg>
  );
}
