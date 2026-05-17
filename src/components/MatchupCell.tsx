// src/components/MatchupCell.tsx
'use client';

import { Matchup, Team } from '@prisma/client';

type MatchupWithTeams = Matchup & { homeTeam: Team; awayTeam: Team };

interface Props {
  matchup: MatchupWithTeams;
  onSwap: (id: string, homeTeamId: string, awayTeamId: string) => Promise<void>;
}

const divisionStyles: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: 'bg-blue-50',  text: 'text-blue-800',  border: 'border-blue-200' },
  1: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
};

function TeamPill({ team }: { team: Team }) {
  const style = team.divisionId in divisionStyles
    ? divisionStyles[team.divisionId]
    : { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium border ${style.bg} ${style.text} ${style.border}`}>
      {team.name}
    </span>
  );
}

export function MatchupCell({ matchup, onSwap }: Props) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <TeamPill team={matchup.homeTeam} />
      <span className="text-xs text-muted-foreground">vs</span>
      <TeamPill team={matchup.awayTeam} />
      <span className="text-[10px] text-muted-foreground border border-border rounded px-1 py-0.5 ml-1">
        {matchup.type === 'cross-division' ? 'cross' : 'div'}
      </span>
      <button
        onClick={() => onSwap(matchup.id, matchup.homeTeamId, matchup.awayTeamId)}
        className="ml-auto opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-foreground transition-opacity"
        aria-label="Swap home and away"
        title="Swap home/away"
      >
        ⇄
      </button>
    </div>
  );
}