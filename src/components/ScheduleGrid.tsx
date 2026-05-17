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
    <div className="overflow-x-auto rounded-lg border border-[#2a2a2c]">
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
  );
}