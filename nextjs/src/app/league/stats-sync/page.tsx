'use client';

// /league/stats-sync — the league-agnostic half of the external data.
//
// These are the nflverse feeds: NFL-wide player stats that are identical no
// matter which league you are looking at. There is deliberately no league
// selector here, because selecting one would change nothing.
//
// The per-league Sleeper feeds live at /league/league-sync.
//
// Member-gated to match the sidebar link; a PLAYER who types the URL gets an
// explanation rather than a panel of 401s, since /api/sync/status would reject
// them anyway.

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { DataSyncPanel } from '@/components/DataSyncPanel';

export default function StatsSyncPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const isCommissioner = role === 'COMMISSIONER';
  const isMember = role === 'MEMBER' || isCommissioner;

  return (
    <div className="min-h-full px-4 py-8 sm:px-8" style={{ color: '#e8e6df' }}>
      <div className="max-w-3xl mx-auto">

        <div className="mb-8">
          <Link
            href="/league/dashboard"
            className="text-[10px] tracking-widest uppercase mb-2 block transition-colors hover:text-[#e8e6df]"
            style={{ color: '#555' }}
          >
            ← Dashboard
          </Link>
          <h1 className="text-lg font-medium mb-1">Stats Sync</h1>
          <p className="text-xs" style={{ color: '#555' }}>
            NFL player stats from nflverse, pulled on a fixed schedule. The same
            data backs every league, so there is nothing to choose here — for
            per-league feeds see{' '}
            <Link href="/league/league-sync" className="underline underline-offset-2">
              League Sync
            </Link>
            .
          </p>
        </div>

        {/* Waiting on the session, rather than flashing the no-access copy first. */}
        {status === 'loading' ? null : isMember ? (
          <DataSyncPanel isCommissioner={isCommissioner} scope="global" />
        ) : (
          <p className="text-xs" style={{ color: '#888' }}>
            Sync schedules are visible to league members. Ask your commissioner for access.
          </p>
        )}
      </div>
    </div>
  );
}
