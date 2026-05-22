'use client';

import { useState } from 'react';

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
  onSwap: (matchupId: string, homeTeamId: string, awayTeamId: string) => Promise<void>;
}

const DIV_STYLES: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: 'bg-blue-950/60',  text: 'text-blue-300',  border: 'border-blue-800/50' },
  1: { bg: 'bg-amber-950/60', text: 'text-amber-300', border: 'border-amber-800/50' },
};

function TeamPill({ team }: { team: Team }) {
  const style = DIV_STYLES[team.divisionId] ?? {
    bg: 'bg-[#1a1a1c]',
    text: 'text-[#888]',
    border: 'border-[#2a2a2c]',
  };
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${style.bg} ${style.text} ${style.border}`}
    >
      {team.name}
    </span>
  );
}

interface MatchupRowProps {
  matchup: Matchup;
  swapping: string | null;
  onSwap: (matchup: Matchup) => Promise<void>;
}

function MatchupRow({ matchup, swapping, onSwap }: MatchupRowProps) {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <TeamPill team={matchup.homeTeam} />
      <span className="text-[#333] text-[11px]">vs</span>
      <TeamPill team={matchup.awayTeam} />
      <span className="text-[10px] text-[#3a3a3c] border border-[#2a2a2c] rounded px-1 py-0.5 shrink-0">
        {matchup.type === 'cross-division' ? 'cross' : 'div'}
      </span>
      {/* Always visible on touch; opacity trick only on non-touch via group-hover */}
      <button
        onClick={() => onSwap(matchup)}
        disabled={swapping === matchup.id}
        className="ml-1 text-[#555] hover:text-[#e8e6df] transition-opacity
                   opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                   disabled:opacity-20 touch-manipulation shrink-0"
        title="Swap home / away"
        aria-label="Swap home and away teams"
      >
        {swapping === matchup.id ? '…' : '⇄'}
      </button>
    </div>
  );
}

export function ScheduleGrid({ weeks, onSwap }: Props) {
  const [swapping, setSwapping] = useState<string | null>(null);

  async function handleSwap(matchup: Matchup): Promise<void> {
    setSwapping(matchup.id);
    try {
      await onSwap(matchup.id, matchup.homeTeamId, matchup.awayTeamId);
    } finally {
      setSwapping(null);
    }
  }

  return (
    <>
      {/* ── Desktop table (hidden on mobile) ── */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#2a2a2c]">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#2a2a2c]">
              <th className="w-10 px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[#555] font-normal">
                Wk
              </th>
              {[1, 2, 3, 4, 5].map((n) => (
                <th
                  key={n}
                  className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[#555] font-normal"
                >
                  Game {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, i) => (
              <tr
                key={i}
                className="border-b border-[#1e1e20] last:border-0 hover:bg-[#141415] group"
              >
                <td className="px-3 py-2 text-[#444] font-medium tabular-nums">{i + 1}</td>
                {week.map((matchup) => (
                  <td key={matchup.id} className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <TeamPill team={matchup.homeTeam} />
                      <span className="text-[#333]">vs</span>
                      <TeamPill team={matchup.awayTeam} />
                      <span className="text-[10px] text-[#3a3a3c] border border-[#2a2a2c] rounded px-1 py-0.5">
                        {matchup.type === 'cross-division' ? 'cross' : 'div'}
                      </span>
                      <button
                        onClick={() => handleSwap(matchup)}
                        disabled={swapping === matchup.id}
                        className="ml-1 opacity-0 group-hover:opacity-100 text-[#555] hover:text-[#e8e6df] transition-opacity disabled:opacity-20"
                        title="Swap home / away"
                        aria-label="Swap home and away teams"
                      >
                        {swapping === matchup.id ? '…' : '⇄'}
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards (hidden on sm+) ── */}
      <div className="sm:hidden space-y-2">
        {weeks.map((week, i) => (
          <div
            key={i}
            className="rounded-lg border border-[#2a2a2c] overflow-hidden group"
          >
            {/* Week header */}
            <div className="px-3 py-1.5 bg-[#141415] border-b border-[#2a2a2c]">
              <span className="text-[10px] uppercase tracking-widest text-[#555] font-normal">
                Week {i + 1}
              </span>
            </div>
            {/* Matchup rows */}
            <div className="divide-y divide-[#1e1e20]">
              {week.map((matchup) => (
                <div key={matchup.id} className="px-3">
                  <MatchupRow
                    matchup={matchup}
                    swapping={swapping}
                    onSwap={handleSwap}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
