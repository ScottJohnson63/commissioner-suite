'use client';

import { useState, useEffect, useMemo } from 'react';
import type { TrendingPlayer } from '@/types/trending';
import { SLEEPER_THUMB } from './shared';

type TickerItem = TrendingPlayer & { rank: number };

export function TrendingTicker({
  adds,
  drops,
  loading,
}: {
  adds: TrendingPlayer[];
  drops: TrendingPlayer[];
  loading: boolean;
}) {
  const items = useMemo<TickerItem[]>(() => {
    const out: TickerItem[] = [];
    const len = Math.max(adds.length, drops.length);
    for (let i = 0; i < len; i++) {
      if (adds[i])  out.push({ ...adds[i],  rank: i + 1 });
      if (drops[i]) out.push({ ...drops[i], rank: i + 1 });
    }
    return out;
  }, [adds, drops]);

  const PAGE_SIZE = 5;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const [page, setPage]       = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (items.length <= PAGE_SIZE) return;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPage((p) => (p + 1) % pageCount);
        setVisible(true);
      }, 350);
    }, 10000);
    return () => clearInterval(id);
  }, [items.length, pageCount]);

  const slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div
      className="rounded-lg px-4 py-2.5 flex items-center gap-3 mb-4"
      style={{ background: '#141415', border: '1px solid #1e1e20' }}
    >
      <a
        href="https://sleeper.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] uppercase tracking-widest shrink-0 transition-colors"
        style={{ color: '#555' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#80ff49')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
      >
        Sleeper Trending
      </a>
      <div className="w-px h-3.5 shrink-0" style={{ background: '#2a2a2c' }} />

      {loading ? (
        <div className="flex gap-4 flex-1">
          {[80, 96, 72, 88, 64].map((w, i) => (
            <div key={i} className="h-3.5 rounded animate-pulse"
              style={{ background: '#1e1e20', width: w }} />
          ))}
        </div>
      ) : (
        <div
          className="flex items-center gap-4 flex-1 min-w-0 overflow-hidden"
          style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease-in-out' }}
        >
          {slice.map((p, idx) => {
            const isAdd = p.type === 'add';
            const accent = isAdd ? '#80ff49' : '#ff6d49';
            return (
              <div key={`${p.type}-${p.player_id}`}
                className={`flex items-center gap-1.5 min-w-0 shrink-0${idx >= 3 ? ' hidden sm:flex' : ''}`}>
                <span className="text-[11px] shrink-0 font-bold" style={{ color: accent }}>
                  {isAdd ? '▲' : '▼'}
                </span>
                <span className="text-[10px] tabular-nums shrink-0 font-medium"
                  style={{ color: accent, opacity: 0.6 }}>
                  #{p.rank}
                </span>
                <div className="relative shrink-0" style={{ width: 22, height: 22 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={SLEEPER_THUMB(p.player_id)}
                    alt={p.name ?? p.player_id}
                    width={22}
                    height={22}
                    className="rounded-full object-cover"
                    style={{ width: 22, height: 22, background: '#1e1e20' }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (sib) sib.style.display = 'flex';
                    }}
                  />
                  <div className="rounded-full items-center justify-center text-[9px] font-medium"
                    style={{
                      display: 'none', width: 22, height: 22, background: '#1e1e20',
                      color: '#555', position: 'absolute', top: 0, left: 0,
                    }}>
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </div>
                </div>
                <span className="text-xs font-medium truncate" style={{ color: '#e8e6df' }}>
                  {p.name ?? `#${p.player_id}`}
                </span>
                {p.position && (
                  <span className="text-[10px] shrink-0 hidden sm:inline" style={{ color: '#444' }}>
                    {p.position}
                  </span>
                )}
                {p.team && (
                  <span className="text-[10px] shrink-0 hidden md:inline" style={{ color: '#333' }}>
                    {p.team}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
