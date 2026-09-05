'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LeagueSelector } from '@/components/LeagueSelector';
import { useSleeperData } from '@/hooks/useSleeperData';
import type { TrendingData } from '@/types/trending';
import type { DbLeague } from '@/types/schedule';
import { LeagueTab }      from '@/components/dashboard/LeagueTab';
import { StatisticsTab }  from '@/components/dashboard/StatisticsTab';
import { NewsTab }        from '@/components/dashboard/NewsTab';
import { SchedulesTab }   from '@/components/dashboard/SchedulesTab';
import { DivisionsTab }   from '@/components/dashboard/DivisionsTab';
import { LotteryTab }     from '@/components/dashboard/LotteryTab';
import { openAppIntro }   from '@/components/intro/AppIntro';

type Tab = 'league' | 'statistics' | 'news' | 'schedules' | 'divisions' | 'lottery';

// The two tabs a signed-out visitor may browse. Everything behind them
// (/api/nfl/*, /api/news, /api/trending) is unauthenticated already, so this
// list and the proxy's PUBLIC_PATHS are the whole story.
const PUBLIC_TABS: Tab[] = ['statistics', 'news'];

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function LeagueDashboardPage() {
  const { sleeperUser, activeLeagueId, setActiveLeagueId } = useSleeperData();
  const [tab, setTab] = useState<Tab>('league');

  const [trending, setTrending]               = useState<TrendingData | null>(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError]     = useState<string | null>(null);

  const { data: session, status } = useSession();
  const role           = session?.user?.role;
  const isCommissioner = role === 'COMMISSIONER';
  const isMember       = role === 'MEMBER' || role === 'COMMISSIONER';
  const isAuthed       = status === 'authenticated';
  const sessionLoading = status === 'loading';

  const [dbLeagues, setDbLeagues] = useState<DbLeague[]>([]);
  const activeDbLeagueId =
    dbLeagues.find((l) => l.sleeperLeagueId === activeLeagueId)?.id ?? null;

  const fetchTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      const res = await fetch('/api/trending?limit=10');
      if (!res.ok) throw new Error('Failed to load trending data');
      setTrending(await res.json() as TrendingData);
    } catch (err) {
      setTrendingError(err instanceof Error ? err.message : 'Error');
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchTrending(); }, [fetchTrending]);

  useEffect(() => {
    // /api/leagues is 401 for signed-out visitors, and its error body is an
    // object — assigning that straight to dbLeagues would break the .find()
    // below. Skip the call entirely, and still guard the shape.
    if (!isAuthed) return;
    void fetch('/api/leagues')
      .then((r) => (r.ok ? (r.json() as Promise<DbLeague[]>) : null))
      .then((data) => { if (Array.isArray(data)) setDbLeagues(data); })
      .catch(() => { /* non-critical */ });
  }, [isAuthed]);

  // League needs a Sleeper account behind it, so it joins the public two only
  // once there is a session.
  const LEFT_TABS: { id: Tab; label: string }[] = [
    ...(isAuthed ? [{ id: 'league' as Tab, label: 'League' }] : []),
    { id: 'statistics', label: 'Statistics' },
    { id: 'news',       label: 'News'       },
  ];

  const MEMBER_TABS: { id: Tab; label: string }[] = [
    { id: 'schedules', label: 'Schedules' },
    { id: 'divisions', label: 'Divisions' },
    { id: 'lottery',   label: 'Lottery'   },
  ];

  const allTabs = [...LEFT_TABS, ...(isMember ? MEMBER_TABS : [])];

  // `tab` defaults to League, which a signed-out visitor cannot see. Falling
  // back to the first visible tab means no separate default per auth state, and
  // it also catches a member who signs out while sitting on Lottery.
  const activeTab: Tab = allTabs.some((t) => t.id === tab) ? tab : PUBLIC_TABS[0];

  // The mobile bar carries every tab a member has, which is more than a phone
  // fits, so it scrolls sideways. Two things stop that hiding the tabs off the
  // right-hand end, which is the failing of a plain scrolling bar: the fade
  // below shows while there is more to reach, and the active tab is pulled into
  // view whenever it changes.
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [tabsScrollable, setTabsScrollable] = useState(false);

  useEffect(() => {
    const row = tabRowRef.current;
    if (!row) return undefined;

    const measure = () =>
      setTabsScrollable(row.scrollWidth - row.clientWidth - row.scrollLeft > 1);

    measure();
    row.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      row.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
    // Signing in or out changes how many tabs there are, and so whether the row
    // overflows at all.
  }, [allTabs.length]);

  useEffect(() => {
    tabRowRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      // `nearest` on both axes: the row is inside a sticky bar, and anything
      // but nearest scrolls the page itself to centre a tab that is already
      // perfectly visible.
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeTab]);

  // One definition for both bars, so the phone's tabs cannot drift from the
  // desktop's. `shrink-0` is what keeps them their own width in the scrolling
  // row rather than squeezing to fit.
  function TabBtn({ id, label }: { id: Tab; label: string }) {
    return (
      <button
        onClick={() => setTab(id)}
        data-active={activeTab === id}
        className="px-4 py-2.5 text-sm font-medium transition-colors shrink-0 whitespace-nowrap"
        style={{
          color: activeTab === id ? '#e8e6df' : '#555',
          borderBottom: `2px solid ${activeTab === id ? '#80ff49' : 'transparent'}`,
          marginBottom: -1,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="min-h-full" style={{ color: '#e8e6df' }}>

      {/* ── Tab bar — mobile ──
          The tabs are the thing you come here to switch, so on a phone they sit
          at the very top of the screen rather than under the title, and stay
          there as the page scrolls. Same tabs and same styling as the desktop
          bar below; the row scrolls where they do not fit. */}
      <div
        className="sm:hidden sticky top-0 z-30 border-b"
        style={{ borderColor: '#1e1e20', background: 'rgba(14,14,15,0.95)', backdropFilter: 'blur(8px)' }}
      >
        <div
          ref={tabRowRef}
          className="flex items-stretch overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {LEFT_TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
          {isMember && (
            <>
              {/* The same break the desktop bar makes between what anyone may
                  read and what running the league needs. */}
              <div className="w-px my-2 mx-1 shrink-0" style={{ background: '#1e1e20' }} />
              {MEMBER_TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
            </>
          )}
        </div>

        {tabsScrollable && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-14"
            style={{
              // Reaching the page's own background rather than stopping at the
              // bar's 95%: a gentler fade over a label that is already dim on a
              // dark ground reads as nothing at all, and the point of it is that
              // the last tab visibly dissolves rather than looking clipped.
              background:
                'linear-gradient(to right, rgba(14,14,15,0) 0%, rgba(14,14,15,0.85) 55%, #0e0e0f 100%)',
            }}
          />
        )}
      </div>

      <div className="px-5 py-6 sm:px-8">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#555' }}>
              League Portal
            </p>
            <h1 className="text-xl font-semibold">Dashboard</h1>
          </div>

          {/* Nothing here until the session resolves — swapping a Sign in button
              for the league selector a moment later reads as a glitch. */}
          <div className="flex items-center gap-3 mt-1">
            {/* Replays the welcome tour. It opens itself on a first visit, so this
                is here for everybody after that — including anyone who ticked
                "Don't show this again". */}
            <button
              onClick={openAppIntro}
              className="text-[11px] font-medium px-3 py-1.5 rounded transition-colors"
              style={{ color: '#80ff49', border: '1px solid rgba(128,255,73,0.3)' }}
            >
              How it works
            </button>

            {sessionLoading ? null : isAuthed ? (
              <>
                <LeagueSelector
                  sleeperUser={sleeperUser}
                  activeLeagueId={activeLeagueId}
                  onSelect={setActiveLeagueId}
                />
                {(sleeperUser?.displayName ?? session?.user?.username) && (
                  <span className="text-xs" style={{ color: '#80ff49' }}>
                    {sleeperUser?.displayName ?? session?.user?.username}
                  </span>
                )}
              </>
            ) : (
              // Links to the app's own login page, which has the OAuth buttons
              // and the commissioner modal. NextAuth's built-in signIn() page
              // has neither.
              <Link
                href="/login"
                className="text-xs px-3 py-1.5 rounded font-medium transition-opacity hover:opacity-80"
                style={{ background: '#80ff49', color: '#0e0e0f' }}
              >
                Sign in
              </Link>
            )}
          </div>
      </div>

      {/* ── Tab bar — desktop ── */}
      <div className="hidden sm:flex items-stretch border-b mb-6" style={{ borderColor: '#1e1e20' }}>
        {LEFT_TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
        {isMember && (
          <>
            <div className="flex-1" />
            <div className="w-px my-2" style={{ background: '#1e1e20' }} />
            {MEMBER_TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
          </>
        )}
      </div>

      {/* ── Tab content ── */}
      {isAuthed && activeTab === 'league' && (
        <LeagueTab sleeperUser={sleeperUser} activeLeagueId={activeLeagueId} />
      )}

      {activeTab === 'statistics' && (
        <StatisticsTab
          trending={trending}
          trendingLoading={trendingLoading}
          trendingError={trendingError}
          onRetryTrending={fetchTrending}
        />
      )}

      {activeTab === 'news' && <NewsTab />}

      {isMember && (
        <>
          {/* Keep SchedulesTab always mounted so fetched data survives tab switches */}
          <div style={{ display: activeTab === 'schedules' ? undefined : 'none' }}>
            <SchedulesTab
              activeLeagueId={activeDbLeagueId}
              sleeperLeagueId={activeLeagueId}
              refreshKey={0}
              isCommissioner={isCommissioner}
            />
          </div>
          {activeTab === 'divisions' && <DivisionsTab activeLeagueId={activeDbLeagueId} sleeperLeagueId={activeLeagueId} isCommissioner={isCommissioner} />}
          {activeTab === 'lottery'   && <LotteryTab   activeLeagueId={activeDbLeagueId} sleeperLeagueId={activeLeagueId} isCommissioner={isCommissioner} />}
        </>
      )}

      {/* ── Attribution ── */}
      <p className="mt-8 text-center text-[11px]" style={{ color: '#80ff49' }}>
        Trending data from{' '}
        <a href="https://sleeper.com" target="_blank" rel="noopener noreferrer"
          className="underline" style={{ color: '#80ff49' }}>Sleeper</a>
        {' '}· Stats from nfl_data_py · Headlines from ESPN
      </p>

      </div>
    </div>
  );
}
