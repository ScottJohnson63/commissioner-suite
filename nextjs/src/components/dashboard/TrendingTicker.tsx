'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import type { TrendingPlayer } from '@/types/trending';
import { SLEEPER_THUMB } from './shared';

type TickerItem = TrendingPlayer & { rank: number };

/** How many players we lay out at once; the fit measurement hides any that overflow. */
const WINDOW = 6;

export function TrendingTicker({
  adds,
  drops,
  loading,
  showHeadshots = false,
}: {
  adds: TrendingPlayer[];
  drops: TrendingPlayer[];
  loading: boolean;
  /**
   * Player headshots are for signed-in members only. Left off, every player
   * falls back to the initial the broken-image path already draws, so the row
   * keeps its shape and nothing shifts when a visitor signs in.
   */
  showHeadshots?: boolean;
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

  const rowRef = useRef<HTMLDivElement | null>(null);
  const [start, setStart]     = useState(0);
  const [visible, setVisible] = useState(true);
  // Players that fit end-to-end inside the row. Starts at 1 so the first paint
  // can never show a sliver of a second player.
  const [fit, setFit]         = useState(1);

  const slice = useMemo<TickerItem[]>(() => {
    if (items.length === 0) return [];
    const count = Math.min(WINDOW, items.length);
    // start is wrapped here, so a shrinking list can never strand the window.
    return Array.from({ length: count }, (_, k) => items[(start + k) % items.length]);
  }, [items, start]);

  /** Count the leading players whose right edge lands inside the row. */
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const rowRight = el.getBoundingClientRect().right;
    let n = 0;
    for (const kid of Array.from(el.children) as HTMLElement[]) {
      // Sub-pixel layout rounding: half a pixel of slack, never a whole player.
      if (kid.getBoundingClientRect().right > rowRight + 0.5) break;
      n++;
    }
    setFit(Math.max(1, n));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, slice]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, loading]);

  // Web fonts land after first paint and change how wide the names are.
  useEffect(() => {
    document.fonts?.ready.then(measure).catch(() => {});
  }, [measure]);

  useEffect(() => {
    if (items.length <= fit) return;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setStart((s) => (s + fit) % items.length);
        setVisible(true);
      }, 350);
    }, 10000);
    return () => clearInterval(id);
  }, [items.length, fit]);

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
        <div className="flex gap-4 flex-1 min-w-0 overflow-hidden">
          {[80, 96, 72, 88, 64].map((w, i) => (
            <div key={i} className="h-3.5 rounded animate-pulse min-w-0"
              style={{ background: '#1e1e20', flex: `0 1 ${w}px`, maxWidth: w }} />
          ))}
        </div>
      ) : (
        <div
          ref={rowRef}
          data-ticker-row
          className="flex items-center gap-4 flex-1 min-w-0 overflow-hidden"
          style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease-in-out' }}
        >
          {slice.map((p, idx) => {
            const isAdd = p.type === 'add';
            const accent = isAdd ? '#80ff49' : '#ff6d49';
            return (
              <div key={`${idx}-${p.type}-${p.player_id}`}
                className="flex items-center gap-1.5 min-w-0 max-w-full shrink-0"
                // Overflowing players keep their box (so the measurement stays
                // stable) but are never drawn half-visible.
                style={{ visibility: idx < fit ? 'visible' : 'hidden' }}
                aria-hidden={idx < fit ? undefined : true}
              >
                <span className="text-[11px] shrink-0 font-bold" style={{ color: accent }}>
                  {isAdd ? '▲' : '▼'}
                </span>
                <span className="text-[10px] tabular-nums shrink-0 font-medium"
                  style={{ color: accent, opacity: 0.6 }}>
                  #{p.rank}
                </span>
                <div className="relative shrink-0" style={{ width: 22, height: 22 }}>
                  {showHeadshots && (
                    <Image
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
                  )}
                  <div className="rounded-full items-center justify-center text-[9px] font-medium"
                    style={{
                      display: showHeadshots ? 'none' : 'flex',
                      width: 22, height: 22, background: '#1e1e20',
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
