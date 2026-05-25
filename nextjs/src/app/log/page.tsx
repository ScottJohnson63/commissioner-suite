'use client';

// src/app/log/page.tsx

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditActionType = 'SYNC' | 'GENERATE' | 'DELETE' | 'EXPORT';

interface AuditLeague {
  id: string;
  name: string;
  season: number;
  sleeperLeagueId: string;
}

interface AuditLogEntry {
  id: string;
  action: AuditActionType;
  leagueId: string | null;
  league: AuditLeague | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<AuditActionType, { label: string; color: string; bg: string }> = {
  SYNC:     { label: 'Sync',     color: '#80ff49', bg: 'rgba(128,255,73,0.12)'  },
  GENERATE: { label: 'Generate', color: '#49b8ff', bg: 'rgba(73,184,255,0.12)' },
  DELETE:   { label: 'Delete',   color: '#ff4949', bg: 'rgba(255,73,73,0.12)'  },
  EXPORT:   { label: 'Export',   color: '#ffb649', bg: 'rgba(255,182,73,0.12)' },
};

function formatDetail(action: AuditActionType, detail: Record<string, unknown>): string {
  switch (action) {
    case 'SYNC':
      return `${detail.teamCount ?? '?'} teams · season ${detail.season ?? '?'}`;
    case 'GENERATE':
      return `${detail.matchupCount ?? '?'} matchups · seed ${detail.seed ?? '?'}`;
    case 'DELETE':
      return `${detail.schedulesDeleted ?? '?'} schedule(s) removed · season ${detail.season ?? '?'}`;
    case 'EXPORT':
      return `${detail.matchupCount ?? '?'} matchups · season ${detail.season ?? '?'}`;
    default:
      return JSON.stringify(detail);
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Log Page ─────────────────────────────────────────────────────────────────

export default function LogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuditActionType | 'ALL'>('ALL');

  const fetchLogs = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/audit?limit=200');
      if (!res.ok) throw new Error('Failed to fetch logs');
      const data = await res.json() as AuditLogEntry[];
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = filter === 'ALL' ? logs : logs.filter((l) => l.action === filter);

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
            <h1 className="text-lg font-medium tracking-tight">Activity Log</h1>
          </div>
          <button
            onClick={fetchLogs}
            className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:border-[#444] transition-colors touch-manipulation"
            style={{ color: '#888' }}
          >
            Refresh
          </button>
        </div>

        {/* ── Filter tabs */}
        <div className="flex gap-1 mb-6 flex-wrap">
          {(['ALL', 'SYNC', 'GENERATE', 'DELETE', 'EXPORT'] as const).map((tab) => {
            const isActive = filter === tab;
            const style = tab !== 'ALL' ? ACTION_STYLES[tab] : null;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className="px-3 py-1 rounded text-xs transition-colors touch-manipulation"
                style={{
                  background: isActive
                    ? (style?.bg ?? 'rgba(232,230,223,0.12)')
                    : 'transparent',
                  color: isActive
                    ? (style?.color ?? '#e8e6df')
                    : '#555',
                  border: `1px solid ${isActive ? (style?.color ?? '#e8e6df') + '44' : '#2a2a2c'}`,
                }}
              >
                {tab === 'ALL' ? 'All' : ACTION_STYLES[tab].label}
                {tab !== 'ALL' && (
                  <span className="ml-1.5 opacity-60">
                    {logs.filter((l) => l.action === tab).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── States */}
        {error && (
          <p className="text-xs mb-4" style={{ color: '#ff4949' }}>{error}</p>
        )}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded border border-[#2a2a2c] animate-pulse"
                style={{ background: '#141415', opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-xs" style={{ color: '#555' }}>No activity yet.</p>
          </div>
        )}

        {/* ── Log entries */}
        {!loading && filtered.length > 0 && (
          <div className="border border-[#2a2a2c] rounded divide-y divide-[#1e1e20]">
            {filtered.map((entry) => {
              const style = ACTION_STYLES[entry.action];
              return (
                <div key={entry.id} className="flex items-start gap-4 px-4 py-3 group">

                  {/* Action badge */}
                  <span
                    className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium w-16 text-center"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#e8e6df] truncate">
                      {entry.league?.name ?? (
                        <span style={{ color: '#555' }}>League removed</span>
                      )}
                      {entry.league && (
                        <span className="ml-2" style={{ color: '#555' }}>
                          · {entry.league.season}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: '#666' }}>
                      {formatDetail(entry.action, entry.detail)}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <time
                    className="shrink-0 text-[11px] mt-0.5 tabular-nums"
                    style={{ color: '#444' }}
                    dateTime={entry.createdAt}
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(entry.createdAt)}
                  </time>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer count */}
        {!loading && filtered.length > 0 && (
          <p className="text-[11px] mt-3 text-right" style={{ color: '#333' }}>
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            {filter !== 'ALL' ? ` · filtered to ${ACTION_STYLES[filter].label}` : ''}
          </p>
        )}
      </div>
    </main>
  );
}
