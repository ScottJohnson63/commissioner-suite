'use client';

interface League {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
}

interface Props {
  leagues: League[];
  activeId: string | null;
  onChange: (id: string) => void;
}

export function LeagueSwitcher({ leagues, activeId: activeId, onChange }: Props) {
  if (leagues.length === 0) return null;

  return (
    <select
      value={activeId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent text-[#e8e6df] text-sm border-none outline-none cursor-pointer"
    >
      {leagues.map((league) => (
        <option key={league.id} value={league.id} className="bg-[#0e0e0f]">
          {league.name} ({league.season})
        </option>
      ))}
    </select>
  );
}