'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

interface ErrorLogEntry {
  id: string;
  message: string;
  stack: string | null;
  username: string | null;
  url: string | null;
  createdAt: string;
}

function formatRelativeTime(iso: string): string {
  const diff    = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours   = Math.floor(diff / 3_600_000);
  const days    = Math.floor(diff / 86_400_000);
  if (minutes < 1)  return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24)   return `${hours}h ago`;
  if (days < 7)     return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function GlobalErrorLogPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.username === 'admin';

  const [logs, setLogs]         = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchLogs = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/errors?limit=200');
      if (!res.ok) throw new Error('Failed to fetch error logs');
      const data = await res.json() as ErrorLogEntry[];
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load error log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) void fetchLogs(); }, [isAdmin, fetchLogs]);

  if (status === 'loading') return null;

  if (!isAdmin) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: '#0e0e0f' }}>
        <p className="text-xs" style={{ color: '#444' }}>Access denied.</p>
      </main>
    );
  }

  function toggleStack(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8" style={{ background: '#0e0e0f', color: '#e8e6df' }}>
      <div className="max-w-3xl mx-auto">

        {/* ── Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/assoc/dashboard"
              className="text-xs tracking-widest uppercase mb-2 block transition-colors hover:text-[#e8e6df]"
              style={{ color: '#555' }}
            >
              ← Dashboard
            </Link>
            <h1 className="text-lg font-medium tracking-tight">Error Log</h1>
            <p className="text-[11px] mt-1" style={{ color: '#555' }}>
              Global runtime errors · username · stack trace
            </p>
          </div>
          <button
            onClick={() => void fetchLogs()}
            className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:border-[#444] transition-colors"
            style={{ color: '#888' }}
          >
            Refresh
          </button>
        </div>

        {/* ── States */}
        {error && <p className="text-xs mb-4" style={{ color: '#ff4949' }}>{error}</p>}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded border border-[#2a2a2c] animate-pulse"
                style={{ background: '#141415', opacity: 1 - i * 0.12 }} />
            ))}
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-20">
            <p className="text-xs" style={{ color: '#555' }}>No errors recorded.</p>
          </div>
        )}

        {/* ── Error entries */}
        {!loading && logs.length > 0 && (
          <div className="border border-[#2a2a2c] rounded divide-y divide-[#1e1e20]">
            {logs.map((entry) => {
              const isOpen = expanded.has(entry.id);
              return (
                <div key={entry.id} className="px-4 py-3">

                  {/* Top row: badge + message + time */}
                  <div className="flex items-start gap-3">
                    <span
                      className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: 'rgba(255,73,73,0.12)', color: '#ff4949' }}
                    >
                      ERR
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: '#e8e6df' }}>
                        {entry.message}
                      </p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {entry.username && (
                          <span className="text-[11px]" style={{ color: '#80ff49' }}>
                            @{entry.username}
                          </span>
                        )}
                        {entry.url && (
                          <span className="text-[11px] truncate max-w-xs" style={{ color: '#555' }}>
                            {entry.url}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <time
                        className="text-[11px] tabular-nums"
                        style={{ color: '#444' }}
                        dateTime={entry.createdAt}
                        title={new Date(entry.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(entry.createdAt)}
                      </time>
                      {entry.stack && (
                        <button
                          onClick={() => toggleStack(entry.id)}
                          className="text-[10px] transition-colors"
                          style={{ color: isOpen ? '#c849ff' : '#444' }}
                        >
                          {isOpen ? 'hide trace ↑' : 'stack trace ↓'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Collapsible stack trace */}
                  {isOpen && entry.stack && (
                    <pre
                      className="mt-3 text-[10px] leading-relaxed overflow-x-auto rounded px-3 py-2.5"
                      style={{
                        background: '#0a0a0b',
                        border: '1px solid #1e1e20',
                        color: '#888',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {entry.stack}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && logs.length > 0 && (
          <p className="text-[11px] mt-3 text-right" style={{ color: '#333' }}>
            {logs.length} error{logs.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </main>
  );
}
