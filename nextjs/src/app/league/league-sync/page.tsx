'use client';

// /league/league-sync — the per-league half of the external data.
//
// Which leagues the app knows about at all, and the Sleeper feeds that act on
// one of them. The NFL-wide nflverse feeds live at /league/stats-sync.
//
// Nothing about the feeds is shown until a league is picked. Every feed here
// acts on one league, so a page that opened straight onto them would beg the
// question "which league is this about?" — and a mis-aimed sync writes real
// data. Choosing first makes the answer unambiguous.
//
// The choice is deliberately not seeded from the saved league: landing on this
// page with a league already active would be exactly the ambiguity above.
// Picking here does update the shared selection, so the dashboard follows.
//
// Member-gated to match the sidebar link; a PLAYER who types the URL gets an
// explanation rather than a panel of 401s, since /api/sync/status would reject
// them anyway.

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LeagueManager } from '@/components/LeagueManager';
import { DataSyncPanel } from '@/components/DataSyncPanel';
import { useSleeperData } from '@/hooks/useSleeperData';
import { PANEL_BG, INNER_BG } from '@/components/dashboard/shared';

export default function LeagueSyncPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const isCommissioner = role === 'COMMISSIONER';
  const isMember = role === 'MEMBER' || isCommissioner;

  const { sleeperUser, setActiveLeagueId, refresh } = useSleeperData();

  // Starts null on every visit — the feeds stay hidden until a card is clicked.
  const [selected, setSelected] = useState<string | null>(null);

  // Bumped after a sync finishes in-process, to re-read what it rewrote.
  const [reloadKey, setReloadKey] = useState(0);

  function choose(sleeperLeagueId: string) {
    setSelected(sleeperLeagueId);
    // Keep the dashboard's dropdown in step with what was picked here.
    setActiveLeagueId(sleeperLeagueId);
  }

  /** Re-reads the allowlist and drops a selection that no longer exists. */
  function onLeaguesChanged(stillPresent: (id: string) => boolean) {
    refresh();
    setSelected((current) => (current && stillPresent(current) ? current : null));
  }

  /**
   * A Sleeper sync stores the league's current name, so a league renamed in
   * Sleeper gets a new name in the database the moment its feed runs. Both
   * lists on this page were read before that, so re-read them — otherwise the
   * card and the "Syncing …" line keep the old name until a full reload.
   */
  function onSynced() {
    setReloadKey((k) => k + 1);
    refresh();
  }

  const selectedName =
    sleeperUser?.leagues.find((l) => l.leagueId === selected)?.name ?? null;

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
          <h1 className="text-lg font-medium mb-1">League Sync</h1>
          <p className="text-xs" style={{ color: '#555' }}>
            Sleeper data for one league at a time, pulled on a fixed schedule.
            NFL-wide player stats live in{' '}
            <Link href="/league/stats-sync" className="underline underline-offset-2">
              Stats Sync
            </Link>
            .
          </p>
        </div>

        {/* Waiting on the session, rather than flashing the no-access copy first. */}
        {status === 'loading' ? null : !isMember ? (
          <p className="text-xs" style={{ color: '#888' }}>
            Sync schedules are visible to league members. Ask your commissioner for access.
          </p>
        ) : (
          <>
            {isCommissioner ? (
              <LeagueManager
                selectedId={selected}
                onSelect={choose}
                onChange={onLeaguesChanged}
                reloadKey={reloadKey}
              />
            ) : (
              <MemberLeaguePicker
                leagues={sleeperUser?.leagues ?? []}
                selectedId={selected}
                onSelect={choose}
              />
            )}

            {selected ? (
              <DataSyncPanel
                isCommissioner={isCommissioner}
                scope="league"
                leagueId={selected}
                leagueName={selectedName}
                onSynced={onSynced}
              />
            ) : (
              <p className="text-xs rounded-lg p-4" style={{ ...PANEL_BG, color: '#888' }}>
                Choose a league above to see its Sleeper feeds.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only counterpart to LeagueManager for members, who can pick a league but
 * not change which ones are registered.
 */
function MemberLeaguePicker({
  leagues,
  selectedId,
  onSelect,
}: {
  leagues: { leagueId: string; name: string; season: number }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg p-4 mb-4" style={PANEL_BG}>
      <h2 className="text-sm font-semibold mb-1">Your leagues</h2>
      <p className="text-xs mb-4" style={{ color: '#888' }}>
        Pick one to see its data feeds.
      </p>

      {leagues.length === 0 ? (
        <p className="text-xs" style={{ color: '#555' }}>
          None of your Sleeper leagues have been registered yet. Ask your
          commissioner to add one.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {leagues.map((league) => {
            const selected = selectedId === league.leagueId;
            return (
              <button
                key={league.leagueId}
                onClick={() => onSelect(league.leagueId)}
                aria-pressed={selected}
                className="rounded p-3 text-left transition-colors"
                style={{
                  ...INNER_BG,
                  borderColor: selected ? '#80ff49' : '#1e1e20',
                  background: selected ? 'rgba(128,255,73,0.06)' : INNER_BG.background,
                }}
              >
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: selected ? '#80ff49' : '#e8e6df' }}
                >
                  {league.name || 'Unnamed league'}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: '#555' }}>
                  {league.leagueId} · {league.season}
                  {selected && ' · selected'}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
