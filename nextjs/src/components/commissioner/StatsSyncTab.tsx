'use client';

// The Stats Sync tab of /league/commissioner — the league-agnostic half of the
// external data.
//
// These are the nflverse feeds: NFL-wide player stats that are identical no
// matter which league you are looking at. There is deliberately nothing to
// choose here, which is why the page's league selector is hidden while this tab
// is open — selecting a league would change nothing on it.
//
// The per-league Sleeper feeds are the League Sync tab next door.

import { DataSyncPanel } from '@/components/DataSyncPanel';

export function StatsSyncTab({ isCommissioner }: { isCommissioner: boolean }) {
  return (
    <>
      <p className="text-xs mb-4" style={{ color: '#555' }}>
        NFL player stats from nflverse, pulled on a fixed schedule. The same data
        backs every league, so there is nothing to choose here — for per-league
        feeds see League Sync.
      </p>

      <DataSyncPanel isCommissioner={isCommissioner} scope="global" />
    </>
  );
}
