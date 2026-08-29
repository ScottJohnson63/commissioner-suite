// tests/components/DataSyncPanel.test.tsx
//
// Renders the Data Sync panel against the exact JSON shape /api/sync/status
// returns. The sync pages are the only place the schedule is surfaced, so a feed that
// fails to render is a silent loss of visibility rather than a crash.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataSyncPanel } from '@/components/DataSyncPanel';

const originalFetch = global.fetch;

function feed(overrides: Record<string, unknown> = {}) {
  return {
    source: 'NFL_WEEKLY',
    label: 'NFL weekly stats',
    description: 'Player box scores from nflverse.',
    provider: 'nflverse',
    cadence: 'Tuesdays at 08:00 UTC',
    seasonal: true,
    willSkip: false,
    scope: 'league',
    nextRunAt: '2026-09-01T08:00:00.000Z',
    prevRunAt: '2026-08-25T08:00:00.000Z',
    resumesAt: '2026-09-01T08:00:00.000Z',
    overdue: false,
    lastRun: null,
    recentRuns: [],
    ...overrides,
  };
}

// jsdom provides no Response global, and the component only reads `ok` and
// `json()`, so a minimal stand-in is enough and avoids a polyfill.
const reply = (ok: boolean, body: unknown) => ({ ok, json: async () => body });

/** Stubs /api/sync/status, and /api/sync/run when a run body is supplied. */
function stubApi(status: Record<string, unknown>, run?: { ok: boolean; body: unknown }) {
  const mock = jest.fn(async (url: unknown) =>
    String(url).includes('/api/sync/run')
      ? reply(run!.ok, run!.body)
      : reply(true, status),
  );
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('<DataSyncPanel />', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { global.fetch = originalFetch; });

  it('renders one card per feed with its schedule', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [
        feed(),
        feed({ source: 'SLEEPER_LEAGUES', label: 'League and rosters', provider: 'Sleeper', cadence: 'On demand', nextRunAt: null, seasonal: false }),
      ],
    });

    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText('NFL weekly stats')).toBeInTheDocument();
    expect(screen.getByText('League and rosters')).toBeInTheDocument();
    expect(screen.getByText('Tuesdays at 08:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('On demand')).toBeInTheDocument();
  });

  // WHY: A feed with no history must still show a card; "never" is the signal
  //      that a schedule exists but has not fired yet.
  it('shows "never" for a feed that has not run', async () => {
    stubApi({ isCommissioner: false, feeds: [feed()] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText('never')).toBeInTheDocument();
  });

  it('renders a null nextRunAt as an em dash rather than "Invalid Date"', async () => {
    stubApi({ isCommissioner: false, feeds: [feed({ nextRunAt: null })] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  // WHY: The annual jobs fire in a later year. Without the year, "Aug 1" shown
  //      in late August reads as a date that has already passed.
  it('includes the year on a next run that is not in the current year', async () => {
    const nextYear = new Date().getFullYear() + 1;
    stubApi({ isCommissioner: false, feeds: [feed({ nextRunAt: `${nextYear}-08-01T08:00:00.000Z` })] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText(new RegExp(String(nextYear)))).toBeInTheDocument();
  });

  it('omits the year on a next run inside the current year', async () => {
    const thisYear = new Date().getFullYear();
    stubApi({ isCommissioner: false, feeds: [feed({ nextRunAt: `${thisYear}-06-15T08:00:00.000Z` })] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    await screen.findByText('NFL weekly stats');
    expect(screen.queryByText(new RegExp(String(thisYear)))).not.toBeInTheDocument();
  });

  // WHY: In the offseason every firing only writes a SKIPPED row, so the
  //      literal next run is true and useless — the question being asked is
  //      "when does it start working again?".
  it('shows the resume date instead of the next skipped firing', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ willSkip: true, nextRunAt: '2026-03-10T08:00:00.000Z',
        resumesAt: '2026-08-04T08:00:00.000Z' })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText('Resumes')).toBeInTheDocument();
    expect(screen.getByText(/Aug 4/)).toBeInTheDocument();
    expect(screen.getByText('offseason until then')).toBeInTheDocument();
    // The skipped firing must not be offered as the answer.
    expect(screen.queryByText(/Mar 10/)).not.toBeInTheDocument();
  });

  it('labels the column "Next run" when the feed is in season', async () => {
    stubApi({ isCommissioner: false, feeds: [feed({ willSkip: false })] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText('Next run')).toBeInTheDocument();
    expect(screen.queryByText('Resumes')).not.toBeInTheDocument();
  });

  it('summarises the last run with status and row count', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({
        lastRun: {
          status: 'SUCCESS', trigger: 'schedule', rowCount: 412,
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          finishedAt: new Date().toISOString(),
        },
      })],
    });

    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText(/success · 2h ago · 412 rows/)).toBeInTheDocument();
  });

  // WHY: The button is the manual-sync capability; showing it to a member would
  //      hand them a 403 instead of an explanation.
  it('hides "Sync now" from a non-commissioner', async () => {
    stubApi({ isCommissioner: false, feeds: [feed()] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    await screen.findByText('NFL weekly stats');
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('shows "Sync now" to a commissioner', async () => {
    stubApi({ isCommissioner: true, feeds: [feed()] });
    render(<DataSyncPanel isCommissioner scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  // WHY: A dispatched job finishes minutes later on GitHub, so claiming "synced"
  //      would send the commissioner looking for data that has not arrived.
  it('reports a dispatched job as queued, not as complete', async () => {
    stubApi({ isCommissioner: true, feeds: [feed()] }, { ok: true, body: { dispatched: true } });

    render(<DataSyncPanel isCommissioner scope="league" leagueId="111" leagueName="Alpha" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText(/Queued on GitHub Actions/)).toBeInTheDocument();
  });

  it('reports an in-process league sync with its count', async () => {
    stubApi(
      { isCommissioner: true, feeds: [feed({ source: 'SLEEPER_LEAGUES' })] },
      { ok: true, body: { synced: 3, results: [] } },
    );

    render(<DataSyncPanel isCommissioner scope="league" leagueId="111" leagueName="Alpha" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('Synced 3 league(s).')).toBeInTheDocument();
  });

  // WHY: The 501 body names the missing environment variable; swallowing it
  //      would leave the commissioner with a button that silently does nothing.
  it('surfaces the server error message verbatim', async () => {
    stubApi(
      { isCommissioner: true, feeds: [feed()] },
      { ok: false, body: { error: 'GITHUB_SYNC_TOKEN is not set' } },
    );

    render(<DataSyncPanel isCommissioner scope="league" leagueId="111" leagueName="Alpha" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('GITHUB_SYNC_TOKEN is not set')).toBeInTheDocument();
  });

  it('refreshes the feed list after a successful run', async () => {
    const mock = stubApi({ isCommissioner: true, feeds: [feed()] }, { ok: true, body: { dispatched: true } });

    render(<DataSyncPanel isCommissioner scope="league" leagueId="111" leagueName="Alpha" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      const statusCalls = mock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/status'));
      expect(statusCalls.length).toBe(2);
    });
  });

  it('shows an error instead of an empty panel when the status call fails', async () => {
    global.fetch = jest.fn(async () => reply(false, {})) as unknown as typeof fetch;
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText('Failed to load sync status')).toBeInTheDocument();
  });

  // ── Did it run, and what changed? ─────────────────────────────────────────

  // WHY: A job that never starts writes no row, so the panel has to say so
  //      outright — otherwise a dead cron looks exactly like a quiet one.
  it('marks a feed whose schedule came and went as overdue', async () => {
    stubApi({ isCommissioner: false, feeds: [feed({ overdue: true })] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText(/nothing was recorded/)).toBeInTheDocument();
  });

  it('reads as up to date after a successful run', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ lastRun: { status: 'SUCCESS', trigger: 'schedule', rowCount: 10,
        startedAt: new Date().toISOString(), finishedAt: null, detail: {} } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText('Up to date')).toBeInTheDocument();
  });

  it('says "never run" rather than leaving the state blank', async () => {
    stubApi({ isCommissioner: false, feeds: [feed()] });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);
    expect(await screen.findByText('Never run')).toBeInTheDocument();
  });

  // WHY: This is the report the commissioner reviews to confirm the sync did
  //      what they expected — raw JSON would not be reviewable.
  it('summarises what an nflverse run covered', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ scope: 'global', lastRun: { status: 'SUCCESS', trigger: 'schedule', rowCount: 412,
        startedAt: new Date().toISOString(), finishedAt: null,
        detail: { season: 2026, week: 3 } } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    expect(await screen.findByText(/Season 2026, week 3/)).toBeInTheDocument();
  });

  it('counts the leagues an in-process sync touched', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ lastRun: { status: 'SUCCESS', trigger: 'manual', rowCount: 2,
        startedAt: new Date().toISOString(), finishedAt: null,
        detail: { leagues: [{ teamCount: 10 }, { teamCount: 12 }] } } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="league" leagueId="111" leagueName="Alpha" />);

    expect(await screen.findByText(/2 leagues, 22 teams/)).toBeInTheDocument();
  });

  // WHY: A skip is the normal offseason outcome, and the reason is the only
  //      thing that distinguishes it from something being broken.
  it('shows why a run skipped', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ scope: 'global', lastRun: { status: 'SKIPPED', trigger: 'schedule', rowCount: 0,
        startedAt: new Date().toISOString(), finishedAt: null,
        detail: { reason: 'Outside the NFL season window (March 02).' } } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    expect(await screen.findByText(/Outside the NFL season window/)).toBeInTheDocument();
  });

  it('surfaces a failure message without the traceback', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ scope: 'global', lastRun: { status: 'FAILED', trigger: 'schedule', rowCount: 0,
        startedAt: new Date().toISOString(), finishedAt: null,
        detail: { error: 'libsql timeout', traceback: 'File "x.py", line 1' } } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    expect(await screen.findByText(/libsql timeout/)).toBeInTheDocument();
    expect(screen.queryByText(/File "x.py"/)).not.toBeInTheDocument();
  });

  // WHY: A field a job starts recording later must not vanish silently just
  //      because describeRun does not know its name yet.
  it('still shows a detail field it does not have a phrasing for', async () => {
    stubApi({
      isCommissioner: false,
      feeds: [feed({ scope: 'global', lastRun: { status: 'SUCCESS', trigger: 'schedule', rowCount: 1,
        startedAt: new Date().toISOString(), finishedAt: null,
        detail: { somethingNew: 'kept' } } })],
    });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    expect(await screen.findByText(/somethingNew: kept/)).toBeInTheDocument();
  });

  it('offers a run log only when there is more than one run', async () => {
    const one = { status: 'SUCCESS', trigger: 'schedule', rowCount: 1,
      startedAt: new Date().toISOString(), finishedAt: null, detail: {} };
    stubApi({ isCommissioner: false, feeds: [feed({ scope: 'global', lastRun: one, recentRuns: [one] })] });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    await screen.findByText('NFL weekly stats');
    expect(screen.queryByText(/Run log/)).not.toBeInTheDocument();
  });

  it('lists the history when there is more than one run', async () => {
    const mk = (startedAt: string) => ({ status: 'SUCCESS', trigger: 'schedule',
      rowCount: 5, startedAt, finishedAt: null, detail: {} });
    const runs = [mk('2026-09-15T08:00:00.000Z'), mk('2026-09-08T08:00:00.000Z')];
    stubApi({ isCommissioner: false, feeds: [feed({ scope: 'global', lastRun: runs[0], recentRuns: runs })] });
    render(<DataSyncPanel isCommissioner={false} scope="global" />);

    expect(await screen.findByText('Run log (2)')).toBeInTheDocument();
  });
});