'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';

const NAV = [
  { label: 'Dashboard', href: '/assoc/dashboard', icon: <GridIcon /> },
  { label: 'Members',   href: '/assoc/members',   icon: <PeopleIcon /> },
];

export function AssocSidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar_expanded');
    if (saved !== null) setExpanded(saved === 'true');
  }, []);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_expanded', String(next));
      return next;
    });
  }

  return (
    <aside
      className="flex flex-col shrink-0 border-r transition-[width] duration-200"
      style={{
        width: expanded ? 216 : 52,
        background: '#0a0a0b',
        borderColor: '#1e1e20',
        overflow: 'hidden',
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
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors"
              style={{
                background: active ? 'rgba(128,255,73,0.1)' : 'transparent',
                color: active ? '#80ff49' : '#666',
                minHeight: 36,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#e8e6df'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#666'; }}
              title={!expanded ? item.label : undefined}
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                {item.icon}
              </span>
              {expanded && <span className="truncate leading-none">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="p-1.5 border-t flex flex-col gap-0.5" style={{ borderColor: '#1e1e20' }}>
        <Link
          href="/league/dashboard"
          className="flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors"
          style={{ color: '#555', minHeight: 36 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          title={!expanded ? 'Back to League' : undefined}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <BackIcon />
          </span>
          {expanded && <span className="truncate">Back to League</span>}
        </Link>

        <button
          onClick={() => void signOut({ callbackUrl: '/' })}
          className="flex items-center gap-3 w-full rounded px-2 py-2 text-sm transition-colors"
          style={{ color: '#555', minHeight: 36 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff4949')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          title={!expanded ? 'Sign out' : undefined}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <SignOutIcon />
          </span>
          {expanded && <span className="truncate">Sign out</span>}
        </button>
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

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 3L3 7.5 8 12M3 7.5h9" />
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
