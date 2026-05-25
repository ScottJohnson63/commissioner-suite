'use client';

import { useState } from 'react';
import type { SleeperUser, SleeperLeague } from '@/hooks/useSleeperData';

const STATUS_COLOR: Record<string, string> = {
  in_season: '#80ff49',
  pre_draft:  '#facc15',
  drafting:   '#60a5fa',
  complete:   '#555',
};

interface Props {
  sleeperUser:    SleeperUser | null;
  activeLeagueId: string | null;
  onSelect:       (id: string) => void;
}

export function LeagueSelector({ sleeperUser, activeLeagueId, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const active = sleeperUser?.leagues.find((l) => l.leagueId === activeLeagueId)
    ?? sleeperUser?.leagues[0]
    ?? null;

  const dot = active ? (STATUS_COLOR[active.status] ?? '#555') : '#555';

  function select(league: SleeperLeague) {
    onSelect(league.leagueId);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border transition-colors"
        style={{
          background:   '#141415',
          borderColor:  active ? '#2a2a2c' : '#2a2a2c',
          color:        active ? '#e8e6df' : '#555',
        }}
      >
        {active && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: dot, display: 'inline-block' }}
          />
        )}
        <span className="truncate max-w-[160px]">
          {active ? active.name : (sleeperUser ? 'No leagues' : 'Loading…')}
        </span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className="shrink-0">
          <path
            d={open ? 'M1 4l3-3 3 3' : 'M1 1l3 3 3-3'}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-9 z-50 rounded-xl shadow-xl flex flex-col overflow-hidden"
          style={{
            background:  '#141415',
            border:      '1px solid #2a2a2c',
            minWidth:    200,
          }}
        >
          {!sleeperUser ? (
            <p className="text-xs px-4 py-3" style={{ color: '#555' }}>Loading leagues…</p>
          ) : sleeperUser.leagues.length === 0 ? (
            <p className="text-xs px-4 py-3" style={{ color: '#555' }}>No leagues found.</p>
          ) : (
            sleeperUser.leagues.map((league) => {
              const isActive = league.leagueId === activeLeagueId;
              const sDot     = STATUS_COLOR[league.status] ?? '#555';
              return (
                <button
                  key={league.leagueId}
                  onClick={() => select(league)}
                  className="flex items-start gap-3 px-4 py-3 text-left transition-colors border-b last:border-b-0"
                  style={{
                    borderColor: '#1e1e20',
                    background:  isActive ? 'rgba(128,255,73,0.06)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = '#1a1a1c';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isActive
                      ? 'rgba(128,255,73,0.06)'
                      : 'transparent';
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                    style={{ background: sDot, display: 'inline-block' }}
                  />
                  <div className="min-w-0">
                    <p
                      className="text-xs font-medium truncate"
                      style={{ color: isActive ? '#80ff49' : '#e8e6df' }}
                    >
                      {league.name}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#555' }}>
                      {league.totalRosters} teams · {league.season}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
