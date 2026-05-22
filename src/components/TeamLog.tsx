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
  matchups: Matchup[];
  teamId: string;
  teams: Team[];
}

export function TeamLog({ matchups, teamId, teams }: Props) {
  const team = teams.find((t) => t.id === teamId);

  return (
    <div className="border border-[#2a2a2c] rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-[#2a2a2c] bg-[#141415]">
        <p className="text-[11px] font-medium text-[#e8e6df] truncate">{team?.name}</p>
        <p className="text-[10px]">
          Div {(team?.divisionId ?? 0) + 1} &middot; {matchups.length} games
        </p>
      </div>
      <div className="divide-y divide-[#1e1e20] max-h-80 overflow-y-auto">
        {matchups.map((m) => {
          const opponent = m.homeTeamId === teamId ? m.awayTeam : m.homeTeam;
          return (
            <div key={m.id} className="px-3 py-2 flex items-center gap-2">
              <span className="text-[10px] text-[#aaa] tabular-nums w-5 shrink-0">
                {m.week}: 
              </span>
              <span className="text-[11px] text-[#aaa] truncate flex-1">
                {opponent.name}
              </span>
              <span
                className="text-[9px] px-1 py-0.5 rounded border shrink-0"
                style={
                  m.type === 'cross-division'
                    ? { color: '#ff6d49', borderColor: 'rgba(255,109,73,0.35)' }
                    : { color: '#c849ff', borderColor: 'rgba(200,73,255,0.35)' }
                }
              >
                {m.type === 'cross-division' ? 'X' : 'D'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}