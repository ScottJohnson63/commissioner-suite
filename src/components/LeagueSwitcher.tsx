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

export function LeagueSwitcher({ leagues, activeId, onChange }: Props) {
  if (leagues.length === 0) return null;

  return (
    <select
      value={activeId ?? ''}
      onChange={(e) => onChange(e.target.value)}
      // min-h ensures a comfortable tap target (44px recommended by Apple/Google)
      className="bg-transparent text-[#e8e6df] text-sm border-none outline-none cursor-pointer
                 min-h-[44px] sm:min-h-0 touch-manipulation"
    >
      {leagues.map((league) => (
        <option key={league.id} value={league.id} className="bg-[#0e0e0f]">
          {league.name} ({league.season})
        </option>
      ))}
    </select>
  );
}
