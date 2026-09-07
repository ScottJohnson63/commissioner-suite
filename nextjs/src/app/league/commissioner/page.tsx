'use client';

// /league/commissioner — running the league, on one page.
//
// These four tabs were scattered: Schedules, Divisions and Lottery sat on the
// right of the dashboard behind a divider, and the card pool's controls sat on
// the right of Draft Deck behind another one. Both were the same apology — a
// page about one thing with administration bolted to the end of its tab bar —
// and neither told a commissioner where to go to run the league.
//
// So the administration is the page now, and the two pages it came from are
// each about their one thing again. The dashboard is what your season looks
// like; Draft Deck is the game. This is the desk you sit at to run either.
//
// Permissions are unchanged, and they are per-tab rather than per-page:
//
//   MEMBER       — reads everything here. The schedule, the divisions and the
//                  lottery results are the league's own record, and a member is
//                  entitled to them. Every control that writes is disabled.
//   COMMISSIONER — the same tabs, with the buttons live.
//
// That is why the nav link is member-visible: gating the page on COMMISSIONER
// would take a member's read access away, which is not what moving the tabs was
// supposed to do. The tabs themselves already take `isCommissioner` and have
// always drawn the line in the right place; the APIs behind them enforce it
// again, so a PLAYER typing the URL gets the explanation below rather than a
// screen of 401s.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LeagueSelector } from '@/components/LeagueSelector';
import { useSleeperData } from '@/hooks/useSleeperData';
import type { DbLeague } from '@/types/schedule';
import type { PoolResponse } from '@/types/cards';
import { SchedulesTab } from '@/components/dashboard/SchedulesTab';
import { DivisionsTab } from '@/components/dashboard/DivisionsTab';
import { LotteryTab } from '@/components/dashboard/LotteryTab';
import { CardAdminPanel } from '@/components/cards/CardAdminPanel';

type Tab = 'schedules' | 'divisions' | 'lottery' | 'draft-deck';

// Draft Deck is last, and named for the page it administers rather than for
// what it does — a commissioner looking for the card pool is looking for the
// game's name, not for "Cards" or "Pool".
const TABS: { id: Tab; label: string }[] = [
  { id: 'schedules',  label: 'Schedules'  },
  { id: 'divisions',  label: 'Divisions'  },
  { id: 'lottery',    label: 'Lottery'    },
  { id: 'draft-deck', label: 'Draft Deck' },
];

export default function CommissionerPage() {
  const { sleeperUser, activeLeagueId, setActiveLeagueId } = useSleeperData();
  const { data: session, status } = useSession();

  const role           = session?.user?.role;
  const isCommissioner = role === 'COMMISSIONER';
  const isMember       = role === 'MEMBER' || isCommissioner;

  const [tab, setTab] = useState<Tab>('schedules');

  const [dbLeagues, setDbLeagues] = useState<DbLeague[]>([]);
  const activeDbLeagueId =
    dbLeagues.find((l) => l.sleeperLeagueId === activeLeagueId)?.id ?? null;

  // The season the card game is being played in, for the Draft Deck tab's reset
  // confirmation. It comes from /api/cards/pool rather than /api/cards/collection
  // because a commissioner's own deck is not this page's business — the pool
  // read is a count, the collection read is every card they own.
  const [gameSeason, setGameSeason] = useState<number | null>(null);
  // Bumped after a rebuild or a reset so the season is re-read; the panel's own
  // notes carry the detail, this just keeps the page honest about the year.
  const [poolKey, setPoolKey] = useState(0);

  useEffect(() => {
    // /api/leagues is 401 for anyone signed out, and its error body is an
    // object — the .find() above needs the array or nothing.
    if (!isMember) return;
    void fetch('/api/leagues')
      .then((r) => (r.ok ? (r.json() as Promise<DbLeague[]>) : null))
      .then((data) => { if (Array.isArray(data)) setDbLeagues(data); })
      .catch(() => { /* non-critical */ });
  }, [isMember]);

  useEffect(() => {
    if (!isMember) return;
    void fetch('/api/cards/pool')
      .then((r) => (r.ok ? (r.json() as Promise<PoolResponse>) : null))
      .then((data) => { if (data) setGameSeason(data.gameSeason); })
      .catch(() => { /* non-critical — the tab says so below */ });
  }, [isMember, poolKey]);

  // One definition for both bars, so the phone's tabs cannot drift from the
  // desktop's. `shrink-0` is what keeps them their own width in the scrolling
  // row rather than squeezing to fit.
  function TabBtn({ id, label }: { id: Tab; label: string }) {
    return (
      <button
        onClick={() => setTab(id)}
        data-active={tab === id}
        className="px-4 py-2.5 text-sm font-medium transition-colors shrink-0 whitespace-nowrap"
        style={{
          color: tab === id ? '#e8e6df' : '#555',
          borderBottom: `2px solid ${tab === id ? '#80ff49' : 'transparent'}`,
          marginBottom: -1,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="min-h-full px-4 py-8 sm:px-8" style={{ color: '#e8e6df' }}>
      <div className="max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/league/dashboard"
              className="text-[10px] tracking-widest uppercase mb-2 block transition-colors hover:text-[#e8e6df]"
              style={{ color: '#555' }}
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-semibold">Commissioner</h1>
            <p className="text-xs mt-1" style={{ color: '#555' }}>
              {isCommissioner
                ? 'The schedule, the divisions, the draft lottery and the card pool.'
                : 'The schedule, the divisions, the draft lottery and the card pool — readable here, editable by your commissioner.'}
            </p>
          </div>

          {/* Three of the four tabs are about one league, so the selector is
              page chrome rather than something a tab carries. Nothing until the
              session resolves — swapping it in a moment later reads as a glitch. */}
          {status !== 'loading' && isMember && (
            <div className="mt-1">
              <LeagueSelector
                sleeperUser={sleeperUser}
                activeLeagueId={activeLeagueId}
                onSelect={setActiveLeagueId}
              />
            </div>
          )}
        </div>

        {/* Waiting on the session, rather than flashing the no-access copy first. */}
        {status === 'loading' ? null : !isMember ? (
          <p className="text-xs" style={{ color: '#888' }}>
            Running the league is visible to league members. Ask your commissioner
            for access.
          </p>
        ) : (
          <>
            {/* ── Tab bar ──
                One row on both sizes, scrolling sideways on a phone where four
                tabs do not fit. No divider and no right-alignment: on this page
                every tab is administration, so there is nothing to separate it
                from. */}
            <div
              className="flex items-stretch overflow-x-auto border-b mb-6 [&::-webkit-scrollbar]:hidden"
              style={{ borderColor: '#1e1e20', scrollbarWidth: 'none', overscrollBehaviorX: 'contain' }}
            >
              {TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
            </div>

            {/* ── Tab content ── */}

            {/* Kept mounted rather than unmounted on a tab switch: the grid is a
                league-wide fetch, and switching to Divisions and back should not
                pay for it twice. */}
            <div style={{ display: tab === 'schedules' ? undefined : 'none' }}>
              <SchedulesTab
                activeLeagueId={activeDbLeagueId}
                sleeperLeagueId={activeLeagueId}
                refreshKey={0}
                isCommissioner={isCommissioner}
              />
            </div>

            {tab === 'divisions' && (
              <DivisionsTab
                activeLeagueId={activeDbLeagueId}
                sleeperLeagueId={activeLeagueId}
                isCommissioner={isCommissioner}
              />
            )}

            {tab === 'lottery' && (
              <LotteryTab
                activeLeagueId={activeDbLeagueId}
                sleeperLeagueId={activeLeagueId}
                isCommissioner={isCommissioner}
              />
            )}

            {tab === 'draft-deck' && (
              isCommissioner ? (
                gameSeason === null ? (
                  <p className="text-xs" style={{ color: '#555' }}>Loading the card pool…</p>
                ) : (
                  <CardAdminPanel
                    gameSeason={gameSeason}
                    onChanged={() => setPoolKey((k) => k + 1)}
                  />
                )
              ) : (
                // The one tab with nothing for a member to read: it is two
                // buttons, and both of them write.
                <p className="text-xs" style={{ color: '#888' }}>
                  Building and resetting the card pool is a commissioner&apos;s job.
                  The game itself is on{' '}
                  <Link href="/league/cards" className="underline underline-offset-2">
                    Draft Deck
                  </Link>
                  .
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
