'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LeagueSelector } from '@/components/LeagueSelector';
import { useSleeperData } from '@/hooks/useSleeperData';
import type { TrendingData } from '@/types/trending';
import { MatchupReportPanel }      from '@/components/dashboard/MatchupReportPanel';
import { WaiverSuggestionsPanel }  from '@/components/dashboard/WaiverSuggestionsPanel';
import { TradeAnalyzerPanel }      from '@/components/dashboard/TradeAnalyzerPanel';
import { StatisticsTab }  from '@/components/dashboard/StatisticsTab';
import { NewsTab }        from '@/components/dashboard/NewsTab';
import { openAppIntro }   from '@/components/intro/AppIntro';

type Tab = 'matchup' | 'waivers' | 'trades' | 'statistics' | 'news';

// The two tabs a signed-out visitor may browse. Everything behind them
// (/api/nfl/*, /api/news, /api/trending) is unauthenticated already, so this
// list and the proxy's PUBLIC_PATHS are the whole story.
const PUBLIC_TABS: Tab[] = ['statistics', 'news'];

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function LeagueDashboardPage() {
  const { sleeperUser, activeLeagueId, setActiveLeagueId } = useSleeperData();
  const [tab, setTab] = useState<Tab>('matchup');

  const [trending, setTrending]               = useState<TrendingData | null>(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError]     = useState<string | null>(null);

  const { data: session, status } = useSession();
  const isAuthed       = status === 'authenticated';
  const sessionLoading = status === 'loading';

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

  // Matchup, Waivers and Trades each read your own roster out of Sleeper, so
  // they join the public two only once there is a session. They used to be
  // three panels stacked inside a single League tab, which meant scrolling past
  // the one you did not come for; a tab apiece is the whole of the change.
  //
  // Schedules, Divisions and Lottery used to sit to the right of these, behind
  // a divider that said "this is administration, not the thing you came for".
  // They now have a page that says it outright — see /league/commissioner.
  const TABS: { id: Tab; label: string }[] = [
    ...(isAuthed
      ? [
          { id: 'matchup' as Tab, label: 'Matchup' },
          { id: 'waivers' as Tab, label: 'Waivers' },
          { id: 'trades'  as Tab, label: 'Trades'  },
        ]
      : []),
    { id: 'statistics', label: 'Statistics' },
    { id: 'news',       label: 'News'       },
  ];

  // `tab` defaults to Matchup, which a signed-out visitor cannot see. Falling
  // back to the first visible tab means no separate default per auth state, and
  // it also catches a member who signs out while sitting on Matchup.
  const activeTab: Tab = TABS.some((t) => t.id === tab) ? tab : PUBLIC_TABS[0];

  // The mobile bar scrolls sideways where its tabs do not fit, which five of
  // them do on any phone. Two things stop that hiding a tab off the right-hand
  // end, which is the failing of a plain scrolling bar: the fade below shows
  // while there is more to reach, and the active tab is pulled into view
  // whenever it changes.
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [tabsScrollable, setTabsScrollable] = useState(false);
  // Whether the row overflows at all, as against `tabsScrollable`, which is
  // only about whether there is more still to the right. It decides the touch
  // handling below, which should not apply to a row that has nowhere to go.
  const [tabsOverflow, setTabsOverflow] = useState(false);

  useEffect(() => {
    const row = tabRowRef.current;
    if (!row) return undefined;

    const measure = () => {
      const overflow = row.scrollWidth - row.clientWidth;
      setTabsOverflow(overflow > 1);
      setTabsScrollable(overflow - row.scrollLeft > 1);
    };

    measure();
    row.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      row.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
    // Signing in or out changes how many tabs there are, and so whether the row
    // overflows at all.
  }, [TABS.length]);

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

  // A phone puts these two in the corner of the title row and the selector on
  // a row of its own; a desktop keeps all three together to the title's right.
  // Defining each once here is what stops the two arrangements drifting apart —
  // the same reason TabBtn above is shared by both tab bars. Each is rendered
  // in both places and hidden in one of them, as the tab bars are.

  // Replays the welcome tour. It opens itself on a first visit, so this is here
  // for everybody after that — including anyone who ticked "Don't show this
  // again".
  const howItWorks = (
    <button
      onClick={openAppIntro}
      className="text-[11px] font-medium px-3 py-1.5 rounded transition-colors shrink-0"
      style={{ color: '#80ff49', border: '1px solid rgba(128,255,73,0.3)' }}
    >
      How it works
    </button>
  );

  const sleeperName = sleeperUser?.displayName ?? session?.user?.username;
  const whoIsSignedIn = sleeperName ? (
    // `truncate` so a long Sleeper name gives way rather than pushing the pair
    // off the edge of a narrow phone.
    <span className="text-xs truncate" style={{ color: '#80ff49' }}>
      {sleeperName}
    </span>
  ) : null;

  // Links to the app's own login page, which has the OAuth buttons and the
  // commissioner modal. NextAuth's built-in signIn() page has neither.
  const signIn = (
    <Link
      href="/login"
      className="text-xs px-3 py-1.5 rounded font-medium transition-opacity hover:opacity-80 shrink-0"
      style={{ background: '#80ff49', color: '#0e0e0f' }}
    >
      Sign in
    </Link>
  );

  return (
    <div className="min-h-full" style={{ color: '#e8e6df' }}>

      {/* ── Tab bar — mobile ──
          The tabs are the thing you come here to switch, so on a phone they sit
          at the very top of the screen rather than under the title, and stay
          there as the page scrolls. Same tabs and same styling as the desktop
          bar below; the row scrolls where they do not fit.

          It pins to the top of `main`, which is the pane that scrolls — see the
          note in league/layout.tsx for why the shell around it has to be sized
          in `dvh` for that to hold still on a phone. */}
      <div
        className="sm:hidden sticky top-0 z-30 border-b"
        style={{ borderColor: '#1e1e20', background: 'rgba(14,14,15,0.95)', backdropFilter: 'blur(8px)' }}
      >
        <div
          ref={tabRowRef}
          className="flex items-stretch overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden"
          style={{
            scrollbarWidth: 'none',
            // A drag that starts on a row with somewhere to go is that row's:
            // `pan-x` keeps the phone from reading it as a page scroll and
            // swallowing it, and `contain` stops a flick past either end from
            // chaining out to the page (or, on iOS, into the back-swipe). A row
            // that fits keeps the default, so a thumb landing on it can still
            // scroll the page.
            touchAction: tabsOverflow ? 'pan-x' : undefined,
            overscrollBehaviorX: 'contain',
          }}
        >
          {TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
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

        {/* ── Header ──
            Two fixed rows on a phone, the wrapping row of before from `sm` up.
            Wrapping made the controls' place depend on how wide they were, and
            their width is the league name's: a short name left room beside
            "Dashboard" and the row stayed whole, a long one did not and the
            controls dropped below the title. So the selector — and the list it
            opens under itself — moved about as leagues were switched. Its own
            row cannot fit or not fit, so it holds still. */}
        <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          {/* The title, and on a phone the corner pair alongside it. From `sm`
              up the corner is empty and this is the plain title block again. */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#555' }}>
                League Portal
              </p>
              <h1 className="text-xl font-semibold">Dashboard</h1>
            </div>

            {/* ── Top right corner — mobile ──
                Nothing here until the session resolves — swapping a Sign in
                button for the Sleeper name a moment later reads as a glitch. */}
            <div className="flex items-center gap-3 min-w-0 sm:hidden">
              {howItWorks}
              {sessionLoading ? null : isAuthed ? whoIsSignedIn : signIn}
            </div>
          </div>

          {/* ── Selector row ──
              The whole of the phone's second row, and on a desktop the three
              controls to the right of the title. Signed out there is no
              selector, so on a phone the row goes with it — its two copies of
              the corner pair are hidden and an empty row would be a gap under
              the title. */}
          <div className={`${isAuthed ? 'flex' : 'hidden'} items-center gap-3 w-full sm:flex sm:w-auto sm:mt-1`}>
            <div className="hidden sm:block">{howItWorks}</div>

            {sessionLoading ? null : isAuthed ? (
              <>
                {/* The phone's row is the selector alone, so it takes all of it:
                    `flex-1` makes the control the same box whatever the league
                    is called — a long name truncates rather than widening it —
                    and the list it opens is anchored to the page's own gutter.
                    From `sm` up it is the plain content-sized control it was. */}
                <LeagueSelector
                  className="flex-1 min-w-0 sm:flex-none"
                  sleeperUser={sleeperUser}
                  activeLeagueId={activeLeagueId}
                  onSelect={setActiveLeagueId}
                />
                <div className="hidden sm:block">{whoIsSignedIn}</div>
              </>
            ) : (
              <div className="hidden sm:block">{signIn}</div>
            )}
          </div>
      </div>

      {/* ── Tab bar — desktop ── */}
      <div className="hidden sm:flex items-stretch border-b mb-6" style={{ borderColor: '#1e1e20' }}>
        {TABS.map(({ id, label }) => <TabBtn key={id} id={id} label={label} />)}
      </div>

      {/* ── Tab content ──
          Each of the three league panels is now the whole of its tab, so each
          gets the full width it used to share. */}
      {isAuthed && activeTab === 'matchup' && (
        <MatchupReportPanel leagueId={activeLeagueId} userId={sleeperUser?.userId ?? null} />
      )}

      {isAuthed && activeTab === 'waivers' && (
        <WaiverSuggestionsPanel leagueId={activeLeagueId} userId={sleeperUser?.userId ?? null} />
      )}

      {isAuthed && activeTab === 'trades' && (
        <TradeAnalyzerPanel leagueId={activeLeagueId} userId={sleeperUser?.userId ?? null} />
      )}

      {activeTab === 'statistics' && (
        <StatisticsTab
          trending={trending}
          trendingLoading={trendingLoading}
          trendingError={trendingError}
          onRetryTrending={fetchTrending}
          isAuthed={isAuthed}
        />
      )}

      {activeTab === 'news' && <NewsTab />}

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
