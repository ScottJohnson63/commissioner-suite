'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { signOut, useSession } from 'next-auth/react';
import type { Route } from 'next';

// ─── Nav definition ───────────────────────────────────────────────────────────

// Route type satisfies Next.js typedRoutes — href must be a known app route.
const BASE_NAV: { label: string; href: Route; icon: React.ReactNode }[] = [
  { label: 'Dashboard',    href: '/league/dashboard', icon: <GridIcon /> },
  { label: 'AI Assistant', href: '/league/ai',        icon: <SparkleIcon /> },
  { label: 'Schedule',     href: '/league/schedule',  icon: <CalendarIcon /> },
];

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
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(true);
  const [overflow, setOverflow] = useState<'hidden' | 'visible'>('hidden');

  const NAV: { label: string; href: Route; icon: React.ReactNode }[] = [
    ...BASE_NAV,
    ...(session?.user?.role === 'MEMBER' || session?.user?.role === 'COMMISSIONER'
      ? [{ label: 'Members',      href: '/league/members' as Route, icon: <PeopleIcon /> }]
      : []),
    ...(session?.user?.role === 'MEMBER' || session?.user?.role === 'COMMISSIONER'
      ? [{ label: 'Activity Log', href: '/league/log'     as Route, icon: <LogIcon />    }]
      : []),
  ];

  // Default collapsed on mobile; respect saved preference otherwise
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_expanded');
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(saved === 'true');
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(window.innerWidth >= 768);
    }
  }, []);

  // Allow tooltips to extend outside the aside once the collapse animation finishes
  useEffect(() => {
    if (expanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverflow('hidden');
    } else {
      const t = setTimeout(() => setOverflow('visible'), 210);
      return () => clearTimeout(t);
    }
  }, [expanded]);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_expanded', String(next));
      return next;
    });
  }

  return (
    <aside
      className="isolate flex flex-col shrink-0 border-r transition-[width] duration-200"
      style={{
        width: expanded ? 216 : 52,
        background: '#0a0a0b',
        borderColor: '#1e1e20',
        overflow,
      }}
    >
      {/* ── Header / toggle ── */}
      <div
        className="flex items-center border-b px-3"
        style={{ borderColor: '#1e1e20', height: 56, gap: expanded ? 8 : 0 }}
      >
        {expanded && (
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
          style={{ color: '#555', marginLeft: expanded ? 0 : 'auto', marginRight: expanded ? 0 : 'auto' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronIcon direction={expanded ? 'left' : 'right'} />
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
                {expanded && <span className="truncate leading-none">{item.label}</span>}
              </Link>
              {!expanded && <NavTooltip label={item.label} />}
            </div>
          );
        })}
      </nav>

      {/* ── Footer / sign out ── */}
      <div className="p-1.5 border-t" style={{ borderColor: '#1e1e20' }}>
        <div className="relative group">
          <button
            onClick={() => void signOut({ callbackUrl: '/' })}
            className="flex items-center gap-3 w-full rounded px-2 py-2 text-sm transition-colors"
            style={{ color: '#555', minHeight: 36 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff4949')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              <SignOutIcon />
            </span>
            {expanded && <span className="truncate">Sign out</span>}
          </button>
          {!expanded && <NavTooltip label="Sign out" />}
        </div>
      </div>
    </aside>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M3.05 3.05l1.42 1.42M10.53 10.53l1.42 1.42M10.53 4.47l1.42-1.42M3.05 11.95l1.42-1.42" />
      <circle cx="7.5" cy="7.5" r="2.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M5 1v3M10 1v3M1.5 6.5h12" />
    </svg>
  );
}


function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="5.5" cy="4.5" r="2" />
      <path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <circle cx="11" cy="4.5" r="1.5" />
      <path d="M11 9.5c1.5.3 3 1.3 3 3.5" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6 2.5H3a1 1 0 00-1 1v8a1 1 0 001 1h3M10 11l3-3.5L10 4M13 7.5H6" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      {direction === 'left'
        ? <path d="M9 2L4 7l5 5" />
        : <path d="M5 2l5 5-5 5" />}
    </svg>
  );
}

function LogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="1.5" width="11" height="12" rx="1.5" />
      <path d="M5 5h5M5 7.5h5M5 10h3" />
    </svg>
  );
}
