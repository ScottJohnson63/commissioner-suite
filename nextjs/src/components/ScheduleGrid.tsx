'use client';

// src/components/ScheduleGrid.tsx

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  divisionId: number;
}

interface Matchup {
  id: string;
  week: number;
  type: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: Team;
  awayTeam: Team;
}

interface Props {
  weeks: Matchup[][];
  onSwap?: (matchupId: string, homeTeamId: string, awayTeamId: string) => Promise<void>;
}

// ─── MatchupRow ───────────────────────────────────────────────────────────────

interface MatchupRowProps {
  matchup: Matchup;
  index: number;
  swapping: string | null;
  onSwap?: (matchup: Matchup) => Promise<void>;
}

function MatchupRow({ matchup, index, swapping, onSwap }: MatchupRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-xs group">
      {/* Game number */}
      <span className="w-6 shrink-0" style={{ color: '#555' }}>
        {index + 1}
      </span>

      {/* Teams */}
      <div className="flex-1 flex items-center gap-1.5 sm:gap-2 min-w-0">
        <span className="text-[#e8e6df] truncate">{matchup.homeTeam.name}</span>
        <span className="shrink-0" style={{ color: '#555' }}>vs</span>
        <span className="text-[#e8e6df] truncate">{matchup.awayTeam.name}</span>
      </div>

      {/* Type badge */}
      <span
        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] ml-2 sm:ml-3"
        style={
          matchup.type === 'division'
            ? { background: 'rgba(200,73,255,0.15)', color: '#c849ff' }
            : { background: 'rgba(255,109,73,0.15)', color: '#ff6d49' }
        }
      >
        {matchup.type === 'division' ? 'DIV' : 'X-DIV'}
      </span>

      {/* Swap — commissioner only */}
      {onSwap && (
        <button
          onClick={() => onSwap(matchup)}
          disabled={swapping === matchup.id}
          className="ml-2 sm:ml-3 shrink-0 transition-all touch-manipulation
                     opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100
                     disabled:opacity-20"
          style={{ color: '#555' }}
          title="Swap home/away"
          aria-label="Swap home and away teams"
          onMouseEnter={(e) => (e.currentTarget.style.color = '#e8e6df')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
        >
          {swapping === matchup.id ? '…' : '⇄'}
        </button>
      )}
    </div>
  );
}

// ─── WeekAccordion ────────────────────────────────────────────────────────────

interface WeekAccordionProps {
  week: number;
  matchups: Matchup[];
  isOpen: boolean;
  onToggle: () => void;
  swapping: string | null;
  onSwap?: (matchup: Matchup) => Promise<void>;
}

function WeekAccordion({ week, matchups, isOpen, onToggle, swapping, onSwap }: WeekAccordionProps) {
  return (
    <div className="border border-[#2a2a2c] rounded">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs
                   hover:bg-[#1a1a1c] transition-colors touch-manipulation"
      >
        <span className="tracking-widest uppercase" style={{ color: '#80ff49' }}>
          Week {week}
        </span>
        <div className="flex items-center gap-3" style={{ color: '#80ff49' }}>
          <span>{matchups.length} game{matchups.length !== 1 ? 's' : ''}</span>
          <span
            className="transition-transform duration-200"
            style={{ display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            ▾
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-[#2a2a2c] divide-y divide-[#1e1e20]">
          {matchups.length === 0 ? (
            <p className="px-4 py-3 text-xs" style={{ color: '#555' }}>No games scheduled.</p>
          ) : (
            matchups.map((m, i) => (
              <MatchupRow
                key={m.id}
                matchup={m}
                index={i}
                swapping={swapping}
                onSwap={onSwap}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── ScheduleGrid ─────────────────────────────────────────────────────────────

export function ScheduleGrid({ weeks, onSwap }: Props) {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(
    () => new Set(weeks.map((_, i) => i + 1)),
  );
  const [swapping, setSwapping] = useState<string | null>(null);

  function toggleWeek(week: number): void {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      next.has(week) ? next.delete(week) : next.add(week);
      return next;
    });
  }

  async function handleSwap(matchup: Matchup): Promise<void> {
    if (!onSwap) return;
    setSwapping(matchup.id);
    try {
      await onSwap(matchup.id, matchup.homeTeamId, matchup.awayTeamId);
    } finally {
      setSwapping(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {weeks.map((matchups, i) => {
        const week = i + 1;
        return (
          <WeekAccordion
            key={week}
            week={week}
            matchups={matchups}
            isOpen={expandedWeeks.has(week)}
            onToggle={() => toggleWeek(week)}
            swapping={swapping}
            onSwap={handleSwap}
          />
        );
      })}
    </div>
  );
}