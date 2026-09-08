// tests/unit/lib/agentTools.test.ts
//
// The three dashboard panels, read as prompt context.
//
// Two things are worth pinning here and nothing else is. First, that the
// blocks say whose players these are: the whole reason this module exists is
// that the assistant kept answering "which running back do you mean?", and the
// only thing standing between it and that answer is the wording of MY STARTERS.
// Second, that a panel is never fetched for a reader who has no roster to fetch
// — the routes take a league and a user, and without both there is nothing to
// ask about.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const matchupGet = jest.fn<(req: unknown) => Promise<Response>>();
const waiverGet  = jest.fn<(req: unknown) => Promise<Response>>();
const tradeGet   = jest.fn<(req: unknown) => Promise<Response>>();

jest.mock('@/app/api/sleeper/matchup-report/route',      () => ({ GET: matchupGet }));
jest.mock('@/app/api/sleeper/waiver-suggestions/route',  () => ({ GET: waiverGet }));
jest.mock('@/app/api/sleeper/trade-suggestions/route',   () => ({ GET: tradeGet }));

import {
  fetchAgentTools, formatAgentTools, formatMatchupReport,
  formatWaiverSuggestions, formatTradeSuggestions,
} from '@/lib/agentTools';
import type { MatchupReportResponse, PlayerProjection } from '@/types/projections';
import type { WaiverSuggestionsResponse, TradeSuggestionsResponse } from '@/types/suggestions';
import type { PlayerContext } from '@/lib/matchupContext';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const bareContext: PlayerContext = {
  opponent: 'MIA', home: true, kickoff: null, stadium: null,
  weather: null, weatherNote: null, opposing: null, line: null,
};

function projection(over: Partial<PlayerProjection> = {}): PlayerProjection {
  return {
    playerId: 'p1', sleeperPlayerId: 'p1', name: 'Test Back', position: 'RB',
    team: 'BUF', floor: 6, ceiling: 18, projected: 12, sigma: 4, games: 5,
    context: bareContext, starter: true, ...over,
  };
}

const matchup: MatchupReportResponse = {
  week: 12, season: 2025,
  myTeam:   { name: 'My Team', rosterId: 1, floor: 90, ceiling: 140, projected: 115, sigma: 20, starterCount: 9, benchProjected: 40, benchCount: 6 },
  opponent: { name: 'Their Team', rosterId: 2, floor: 88, ceiling: 136, projected: 110, sigma: 19, starterCount: 9, benchProjected: 35, benchCount: 6 },
  myPlayers: [
    projection({ name: 'Starting Back', starter: true }),
    projection({ playerId: 'p2', name: 'Benched Back', starter: false, projected: 9 }),
  ],
  opponentPlayers: [projection({ playerId: 'p3', name: 'Their Back' })],
  narrative: 'Close one.',
};

function makeRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  matchupGet.mockReset();
  waiverGet.mockReset();
  tradeGet.mockReset();
});

// ── Fetching ──────────────────────────────────────────────────────────────────

describe('fetchAgentTools', () => {
  // WHY: Every one of these routes answers for one manager's roster. Without a
  //      league and a user there is no roster, and calling anyway would spend a
  //      Sleeper build on a request that cannot mean anything.
  it('fetches nothing when the league or the Sleeper user is missing', async () => {
    await expect(fetchAgentTools(null, 'user-1', { matchup: true }))
      .resolves.toEqual({ matchup: null, waivers: null, trades: null, errors: [] });
    await expect(fetchAgentTools('league-1', null, { matchup: true }))
      .resolves.toEqual({ matchup: null, waivers: null, trades: null, errors: [] });
    expect(matchupGet).not.toHaveBeenCalled();
  });

  // WHY: Each panel is a live build behind two model calls. Asking for the
  //      waiver scan on a start/sit question is a choice; fetching all three
  //      every time would not be.
  it('calls only the panels that were asked for', async () => {
    waiverGet.mockResolvedValue(makeRes({ suggestions: [] }));

    const tools = await fetchAgentTools('league-1', 'user-1', { waivers: true });

    expect(waiverGet).toHaveBeenCalledTimes(1);
    expect(matchupGet).not.toHaveBeenCalled();
    expect(tradeGet).not.toHaveBeenCalled();
    expect(tools.waivers).toEqual({ suggestions: [] });
  });

  // WHY: The identifiers have to reach the route, and they only reach it
  //      through the query string of the request built here.
  it('passes the league and user through as query parameters', async () => {
    matchupGet.mockResolvedValue(makeRes(matchup));

    await fetchAgentTools('league-9', 'user-9', { matchup: true });

    const req = matchupGet.mock.calls[0][0] as { nextUrl: URL };
    expect(req.nextUrl.searchParams.get('leagueId')).toBe('league-9');
    expect(req.nextUrl.searchParams.get('userId')).toBe('user-9');
  });

  // WHY: A panel that cannot answer must not take the answer down with it. The
  //      reason is kept so the model can say what is missing rather than
  //      inventing around the hole.
  it('records a failed panel as an error and still returns the others', async () => {
    matchupGet.mockResolvedValue(makeRes({ error: 'No matchup found for this week' }, false, 404));
    waiverGet.mockResolvedValue(makeRes({ suggestions: [] }));

    const tools = await fetchAgentTools('league-1', 'user-1', { matchup: true, waivers: true });

    expect(tools.matchup).toBeNull();
    expect(tools.waivers).not.toBeNull();
    expect(tools.errors).toEqual(['Matchup report: No matchup found for this week']);
  });

  // WHY: A route that throws is the same situation as one that 500s, and the
  //      assistant should answer from the rest of its context either way.
  it('survives a panel that throws', async () => {
    tradeGet.mockRejectedValue(new Error('Sleeper unreachable'));

    const tools = await fetchAgentTools('league-1', 'user-1', { trades: true });

    expect(tools.trades).toBeNull();
    expect(tools.errors[0]).toContain('Sleeper unreachable');
  });
});

// ── Formatting ────────────────────────────────────────────────────────────────

describe('formatMatchupReport', () => {
  // WHY: This is the fix for the bug in the issue. "Should I start or sit my
  //      running back" was answered with "I can't tell which back is yours",
  //      and the only thing that changes that is the block naming them as MINE.
  it('labels the reader\'s own players as theirs, starters and bench alike', () => {
    const block = formatMatchupReport(matchup);
    expect(block).toContain('MY STARTERS');
    expect(block).toContain('Starting Back');
    expect(block).toContain('MY BENCH');
    expect(block).toContain('Benched Back');
    expect(block).toContain('OPPONENT STARTERS');
    expect(block).toContain('Their Back');
  });

  // WHY: A projection without its band is a point estimate presented as a fact.
  //      The gap between floor and ceiling is half of any start/sit call.
  it('carries the floor/ceiling band and the projected margin', () => {
    const block = formatMatchupReport(matchup);
    expect(block).toContain('floor 6.0, ceiling 18.0');
    expect(block).toContain('PROJECTED MARGIN: +5.0');
  });

  // WHY: A lineup nobody has set is a real state before kickoff, and it reads
  //      as a data failure unless the block says which it is.
  it('says so when no lineup has been set', () => {
    const block = formatMatchupReport({
      ...matchup,
      myPlayers: [projection({ starter: false })],
    });
    expect(block).toContain('Lineup not set for this week.');
  });
});

describe('formatWaiverSuggestions', () => {
  const waivers: WaiverSuggestionsResponse = {
    weakPositions: ['RB'],
    positionNeeds: [
      { position: 'RB', slots: 2, mine: 7.4, median: 12.1, rank: 10, of: 12, games: 8, weak: true, unmeasured: false },
      { position: 'QB', slots: 1, mine: 0, median: 18, rank: 12, of: 12, games: 0, weak: false, unmeasured: true },
    ],
    starterSlots: { RB: 2, QB: 1 },
    scanned: 214,
    suggestions: [{
      playerId: 'w1', name: 'Free Agent Back', position: 'RB', team: 'NYJ', headshot: null,
      recentAvg: 11.2, games: 3, floor: 4.1, ceiling: 17.5, projected: 10.8,
      context: bareContext, reason: 'Lead back since the trade deadline.', trendingCount: 12043,
    }],
    window: { season: 2025, startWeek: 9, endWeek: 11, fallback: false },
    week: 12,
  };

  // WHY: "Who should I pick up" is a question about the asker's own holes, and
  //      the ranked needs are what turn a list of free agents into an answer.
  it('names the reader\'s weak positions and the free agents that address them', () => {
    const block = formatWaiverSuggestions(waivers);
    expect(block).toContain('MY POSITION NEEDS');
    expect(block).toContain('RB: rank 10/12');
    expect(block).toContain('WEAK');
    expect(block).toContain('Genuinely weak: RB.');
    expect(block).toContain('Free Agent Back');
    expect(block).toContain('added 12043x league-wide');
    expect(block).toContain('214 players were scanned');
  });

  // WHY: A zero that means "not measured" and a zero that means "scored none"
  //      are different answers, and the model cannot tell them apart unaided.
  it('marks an unmeasured position rather than reporting it as zero', () => {
    expect(formatWaiverSuggestions(waivers)).toContain('not measured, no games in the window');
  });

  // WHY: The window is the difference between "12 a week" and "12, once, in
  //      February". It is on the response for exactly this reason.
  it('names the weeks the averages cover', () => {
    expect(formatWaiverSuggestions(waivers)).toContain('2025 wks 9-11');
  });
});

describe('formatTradeSuggestions', () => {
  const base: TradeSuggestionsResponse = {
    myPositionRanks: { RB: 10, WR: 3 },
    starterSlots: { RB: 2, WR: 3 },
    proposals: [{
      targetTeamName: 'Rival Squad', targetOwnerId: 'o2',
      give:    [{ playerId: 'g1', sleeperPlayerId: 'g1', name: 'My Spare WR', position: 'WR', seasonPts: 140, depthRank: 4, starter: false }],
      receive: [{ playerId: 'r1', sleeperPlayerId: 'r1', name: 'Their Spare RB', position: 'RB', seasonPts: 155, depthRank: 3, starter: false }],
      fairnessScore: 92, lineupGain: 18.4, theirLineupGain: 12.1,
      acceptance: 'mutual', summary: 'Both rosters start someone better.',
    }],
    scoredPlayers: 180, upgradesAvailable: 22, valueBasis: 'season-points',
  };

  // WHY: A proposal the reader cannot act on is not a proposal. Who, what for,
  //      and why they would say yes are all of it.
  it('names both sides of the deal and what each gains', () => {
    const block = formatTradeSuggestions(base);
    expect(block).toContain('With Rival Squad');
    expect(block).toContain('I GIVE WR My Spare WR');
    expect(block).toContain('I GET RB Their Spare RB');
    expect(block).toContain('My lineup gains 18.4, theirs gains 12.1');
    expect(block).toContain('acceptance: mutual');
  });

  // WHY: Projected values are points per GAME and season values are totals.
  //      They differ by two orders of magnitude, and a model that prints one as
  //      the other has invented a season.
  it('says which scale the numbers are on', () => {
    expect(formatTradeSuggestions(base)).toContain('season points to date');
    expect(formatTradeSuggestions({
      ...base,
      valueBasis: 'projected',
      valueWindow: { season: 2025, startWeek: 1, endWeek: 3, fallback: true },
    })).toContain('per-game numbers, never season totals');
  });

  // WHY: "No trades found" is not actionable. Each empty case has a different
  //      cause and only one of them is worth looking again at.
  it('explains an empty list by its actual reason', () => {
    expect(formatTradeSuggestions({ ...base, proposals: [], noTradesReason: 'no-stats' }))
      .toContain('no points for these rosters');
    expect(formatTradeSuggestions({ ...base, proposals: [], noTradesReason: 'no-upgrades' }))
      .toContain('no player on another roster would improve');
  });
});

describe('formatAgentTools', () => {
  // WHY: Nothing fetched means nothing in the prompt — an empty header block
  //      would spend tokens telling the model that it has no data twice.
  it('renders nothing when no panel answered', () => {
    expect(formatAgentTools({ matchup: null, waivers: null, trades: null, errors: [] })).toBe('');
  });

  // WHY: The model should be able to say "your matchup did not load" rather
  //      than answer a lineup question with no lineup and not mention it.
  it('reports the panels that failed', () => {
    const block = formatAgentTools({
      matchup: null, waivers: null, trades: null, errors: ['Matchup report: HTTP 500'],
    });
    expect(block).toContain('PANEL DATA UNAVAILABLE');
    expect(block).toContain('Matchup report: HTTP 500');
  });
});
