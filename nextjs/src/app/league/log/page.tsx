'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

// ─── Badge helpers ────────────────────────────────────────────────────────────

interface Badge { label: string; color: string; bg: string }

const B = {
  schedule:   { label: 'Schedule',   color: '#49b8ff', bg: 'rgba(73,184,255,0.12)'  },
  division:   { label: 'Division',   color: '#c849ff', bg: 'rgba(200,73,255,0.12)'  },
  lottery:    { label: 'Lottery',    color: '#facc15', bg: 'rgba(250,204,21,0.12)'  },
  draftOrder: { label: 'Draft Order',color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  sync:       { label: 'Sync',       color: '#80ff49', bg: 'rgba(128,255,73,0.12)'  },
  created:    { label: 'Created',    color: '#80ff49', bg: 'rgba(128,255,73,0.12)'  },
  rerun:      { label: 'Re-Created', color: '#facc15', bg: 'rgba(250,204,21,0.12)' },
  deleted:    { label: 'Deleted',    color: '#ff4949', bg: 'rgba(255,73,73,0.12)'   },
  exported:   { label: 'Exported',   color: '#ffb649', bg: 'rgba(255,182,73,0.12)'  },
  synced:     { label: 'Synced',     color: '#80ff49', bg: 'rgba(128,255,73,0.12)'  },
} satisfies Record<string, Badge>;

function getBadges(action: AuditActionType, detail: Record<string, unknown>): [Badge, Badge] {
  switch (action) {
    case 'SYNC':     return [B.sync,     B.synced];
    case 'DELETE':   return [B.schedule, B.deleted];
    case 'EXPORT':   return [B.schedule, B.exported];
    case 'GENERATE':
      if (detail.type === 'schedule')    return [B.schedule,   B.created];
      if (detail.type === 'divisions')   return [B.division,   B.created];
      if (detail.type === 'lottery')     return [B.lottery,    detail.rerun ? B.rerun : B.created];
      if (detail.type === 'draft_order') return [B.draftOrder, B.created];
      return [{ label: 'Action', color: '#888', bg: 'rgba(136,136,136,0.1)' }, B.created];
    default:
      return [{ label: action, color: '#888', bg: 'rgba(136,136,136,0.1)' }, B.created];
  }
}

// ─── Detail line ──────────────────────────────────────────────────────────────

function formatDetail(action: AuditActionType, detail: Record<string, unknown>): string {
  switch (action) {
    case 'SYNC':
      return `${detail.teamCount ?? '?'} teams synced · season ${detail.season ?? '?'}`;

    case 'GENERATE': {
      if (detail.type === 'schedule') {
        return `${detail.matchupCount ?? '?'} matchups · season ${detail.season ?? '?'} · seed ${detail.seed ?? '?'}`;
      }
      if (detail.type === 'divisions') {
        const divs = Array.isArray(detail.divisions) ? (detail.divisions as { division: number }[]) : [];
        const d1 = divs.filter((d) => d.division === 1).length;
        const d2 = divs.filter((d) => d.division === 2).length;
        return `${detail.teamCount ?? '?'} teams · Div 1: ${d1} · Div 2: ${d2}`;
      }
      if (detail.type === 'lottery') {
        const picks = Array.isArray(detail.picks)
          ? (detail.picks as { pick: number; name: string; ownerName: string | null }[])
          : [];
        const first = picks.find((p) => p.pick === 1);
        const label = first ? `${first.name}${first.ownerName ? ` (${first.ownerName})` : ''}` : '—';
        return `1st pick → ${label} · ${(detail.totalDraws as number | undefined)?.toLocaleString() ?? '?'} draws`;
      }
      if (detail.type === 'draft_order') {
        const picks = Array.isArray(detail.picks)
          ? (detail.picks as { pick: number; name: string; ownerName: string | null; source: string }[])
          : [];
        const first = picks.find((p) => p.pick === 1);
        const label = first ? `${first.name}${first.ownerName ? ` (${first.ownerName})` : ''}` : '—';
        return `${picks.length} picks · Pick 1 → ${label}`;
      }
      return JSON.stringify(detail);
    }

    case 'DELETE':
      return `${detail.schedulesDeleted ?? '?'} schedule(s) removed · season ${detail.season ?? '?'}`;

    case 'EXPORT':
      return `${detail.matchupCount ?? '?'} matchups exported · season ${detail.season ?? '?'}`;

    default:
      return JSON.stringify(detail);
  }
}

// ─── Time helper ──────────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

const FILTER_OPTS = ['ALL', 'SYNC', 'GENERATE', 'DELETE', 'EXPORT'] as const;
type FilterOpt = typeof FILTER_OPTS[number];

export default function LeagueLogPage() {
  const [logs, setLogs]       = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<FilterOpt>('ALL');

  const fetchLogs = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/audit?limit=200');
      if (!res.ok) throw new Error('Failed to fetch logs');
      const data = await res.json() as AuditLogEntry[];
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  const filtered = filter === 'ALL' ? logs : logs.filter((l) => l.action === filter);

  return (
    <div className="px-5 py-6 sm:px-8 max-w-3xl" style={{ color: '#e8e6df' }}>

      {/* ── Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/league/dashboard"
            className="text-[10px] tracking-widest uppercase mb-2 block transition-colors hover:text-[#e8e6df]"
            style={{ color: '#555' }}
          >
            ← Dashboard
          </Link>
          <h1 className="text-lg font-medium tracking-tight">Activity Log</h1>
        </div>
        <button
          onClick={() => void fetchLogs()}
          className="px-3 py-1.5 text-xs border border-[#2a2a2c] rounded hover:border-[#444] transition-colors"
          style={{ color: '#888' }}
        >
          Refresh
        </button>
      </div>

      {/* ── Filter tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {FILTER_OPTS.map((opt) => {
          const isActive = filter === opt;
          const count    = opt !== 'ALL' ? logs.filter((l) => l.action === opt).length : null;
          return (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className="px-3 py-1 rounded text-xs transition-colors"
              style={{
                background: isActive ? 'rgba(232,230,223,0.1)' : 'transparent',
                color:      isActive ? '#e8e6df' : '#555',
                border:     `1px solid ${isActive ? '#444' : '#2a2a2c'}`,
              }}
            >
              {opt === 'ALL' ? 'All' : opt.charAt(0) + opt.slice(1).toLowerCase()}
              {count !== null && <span className="ml-1.5 opacity-50">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── States */}
      {error && <p className="text-xs mb-4" style={{ color: '#ff4949' }}>{error}</p>}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded border border-[#2a2a2c] animate-pulse"
              style={{ background: '#141415', opacity: 1 - i * 0.1 }} />
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
            const [tabBadge, actBadge] = getBadges(entry.action, entry.detail);
            return (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">

                {/* Two badges */}
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: tabBadge.bg, color: tabBadge.color }}>
                    {tabBadge.label}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: actBadge.bg, color: actBadge.color }}>
                    {actBadge.label}
                  </span>
                </div>

                {/* Detail */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: '#e8e6df' }}>
                    {entry.league?.name ?? <span style={{ color: '#555' }}>League removed</span>}
                    {entry.league && (
                      <span className="ml-2" style={{ color: '#555' }}>· {entry.league.season}</span>
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

      {!loading && filtered.length > 0 && (
        <p className="text-[11px] mt-3 text-right" style={{ color: '#333' }}>
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          {filter !== 'ALL' ? ` · ${filter.charAt(0) + filter.slice(1).toLowerCase()} only` : ''}
        </p>
      )}
    </div>
  );
}
