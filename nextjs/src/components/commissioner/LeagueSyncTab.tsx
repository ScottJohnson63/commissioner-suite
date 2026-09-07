'use client';

// The League Sync tab of /league/commissioner — the per-league half of the
// external data.
//
// Which leagues the app knows about at all, and the Sleeper feeds that act on
// one of them. The NFL-wide nflverse feeds are the Stats Sync tab next door.
//
// Nothing about the feeds is shown until a league is picked. Every feed here
// acts on one league, so a tab that opened straight onto them would beg the
// question "which league is this about?" — and a mis-aimed sync writes real
// data. Choosing first makes the answer unambiguous.
//
// The choice is deliberately not seeded from the saved league: opening this tab
// with a league already active would be exactly the ambiguity above. That is
// also why the page hides its own league selector here — a selector in the
// header reading "this one" would undo the whole point of the picker below.
// Picking here does update the shared selection, so the dashboard follows.

import { useState } from 'react';
import { LeagueManager } from '@/components/LeagueManager';
import { DataSyncPanel } from '@/components/DataSyncPanel';
import { PANEL_BG, INNER_BG } from '@/components/dashboard/shared';
import type { SleeperUser } from '@/hooks/useSleeperData';

export function LeagueSyncTab({
  isCommissioner,
  sleeperUser,
  onActiveLeague,
  onLeaguesReload,
}: {
  isCommissioner: boolean;
  sleeperUser: SleeperUser | null;
  /** Keeps the page's shared league selection in step with the pick made here. */
  onActiveLeague: (sleeperLeagueId: string) => void;
  /** Re-reads the registered leagues the page and this tab both draw from. */
  onLeaguesReload: () => void;
}) {
  // Starts null on every visit — the feeds stay hidden until a card is clicked.
  const [selected, setSelected] = useState<string | null>(null);

  // Bumped after a sync finishes in-process, to re-read what it rewrote.
  const [reloadKey, setReloadKey] = useState(0);

  function choose(sleeperLeagueId: string) {
    setSelected(sleeperLeagueId);
    onActiveLeague(sleeperLeagueId);
  }

  /** Re-reads the allowlist and drops a selection that no longer exists. */
  function onLeaguesChanged(stillPresent: (id: string) => boolean) {
    onLeaguesReload();
    setSelected((current) => (current && stillPresent(current) ? current : null));
  }

  /**
   * A Sleeper sync stores the league's current name, so a league renamed in
   * Sleeper gets a new name in the database the moment its feed runs. Both
   * lists here were read before that, so re-read them — otherwise the card and
   * the "Syncing …" line keep the old name until a full reload.
   */
  function onSynced() {
    setReloadKey((k) => k + 1);
    onLeaguesReload();
  }

  const selectedName =
    sleeperUser?.leagues.find((l) => l.leagueId === selected)?.name ?? null;

  return (
    <>
      <p className="text-xs mb-4" style={{ color: '#555' }}>
        Sleeper data for one league at a time, pulled on a fixed schedule.
        NFL-wide player stats are in Stats Sync.
      </p>

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
