// src/components/DashboardHeader.tsx
'use client';

import { useRouter } from 'next/navigation';

interface Props {
  leagueName: string;
  season: number;
  scheduleId: string;
  leagueId: string;
}

export function DashboardHeader({ leagueName, season, scheduleId: _scheduleId, leagueId }: Props) {
  const router = useRouter();

  async function handleRegenerate(): Promise<void> {
    await fetch(`/api/leagues/${leagueId}/schedule`, { method: 'POST' });
    router.refresh();
  }

  async function handleExport(): Promise<void> {
    const res = await fetch(`/api/leagues/${leagueId}/schedule/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${season}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">{leagueName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {season} season &middot; 13 weeks
        </p>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <button onClick={handleRegenerate} className="btn flex-1 sm:flex-none touch-manipulation">
          Regenerate
        </button>
        <button onClick={handleExport} className="btn flex-1 sm:flex-none touch-manipulation">
          Export CSV
        </button>
      </div>
    </div>
  );
}
