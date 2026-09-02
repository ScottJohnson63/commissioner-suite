// tests/app/api/cards/route.test.ts
//
// Covers the four card-game routes at the boundary: who is allowed in, and how
// each refusal is reported.
//
// The dealing itself is tested in tests/unit/lib/cards/packs.test.ts, which can
// pin an RNG; what matters here is everything around it. Two cases carry real
// weight. A member out of packs must get 409 rather than 403 — nothing about
// them is wrong, they have just spent the ration — and the season reset must
// refuse a request that does not name the season, because a bare POST that
// defaulted to "this season" is one mis-click away from destroying every
// collection in the league.

import { NextRequest } from 'next/server';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockRequireUser = jest.fn<() => Promise<unknown>>();
const mockRequireCommissioner = jest.fn<() => Promise<unknown>>();
const mockOpenOnePack = jest.fn<() => Promise<unknown>>();
const mockReadAllowance = jest.fn<() => Promise<unknown>>();
const mockReadDeck = jest.fn<() => Promise<unknown>>();
const mockReadLeaderboard = jest.fn<() => Promise<unknown>>();
const mockClaimWildcard = jest.fn<() => Promise<unknown>>();
const mockSetRosterSlot = jest.fn<() => Promise<unknown>>();
const mockClaimBonuses = jest.fn<() => Promise<unknown>>();
const mockRebuild = jest.fn<() => Promise<unknown>>();
const mockAvailableSeasons = jest.fn<() => Promise<number[]>>();
const mockCounts = {
  ownership: jest.fn<() => Promise<number>>(),
  grant: jest.fn<() => Promise<number>>(),
  opening: jest.fn<() => Promise<number>>(),
  wildcard: jest.fn<() => Promise<number>>(),
  roster: jest.fn<() => Promise<number>>(),
  starter: jest.fn<() => Promise<number>>(),
  bonus: jest.fn<() => Promise<number>>(),
  image: jest.fn<() => Promise<number>>(),
};
/**
 * Deletes forward their arguments.
 *
 * A reset that dropped its `where` would clear every season at once, so the
 * scoping is the part worth asserting — "it was called" would pass either way.
 */
type DeleteArgs = { where: { gameSeason: number } };
const mockDeletes = {
  ownership: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  grant: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  opening: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  wildcard: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  roster: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  starter: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  bonus: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
  image: jest.fn<(a?: DeleteArgs) => Promise<unknown>>(),
};

jest.mock('@/lib/apiAuth', () => ({
  requireUser: () => mockRequireUser(),
  requireCommissioner: () => mockRequireCommissioner(),
}));
jest.mock('@/lib/cards/service', () => ({
  openOnePack: () => mockOpenOnePack(),
  readAllowance: () => mockReadAllowance(),
  readDeck: () => mockReadDeck(),
  readLeaderboard: () => mockReadLeaderboard(),
  setRosterSlot: () => mockSetRosterSlot(),
  invalidatePoolCache: jest.fn(),
}));
jest.mock('@/lib/cards/pool', () => ({
  rebuildCardPool: () => mockRebuild(),
  availableSeasons: () => mockAvailableSeasons(),
}));
jest.mock('@/lib/cards/allowance', () => ({
  gameSeason: () => 2026,
  claimWildcard: () => mockClaimWildcard(),
  currentAllowance: async () => ({
    poolSize: 1832, claimed: 45, remainingCards: 1787, members: 2, perWeek: 10,
  }),
}));
jest.mock('@/lib/sleeper/week', () => ({ resolveWeek: async () => 3 }));
jest.mock('@/lib/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/cards/bonus', () => ({
  claimBonuses: () => mockClaimBonuses(),
  HIGH_SCORE_THRESHOLD: 100,
}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: async () => ({ sleeperUserId: 'sleeper-1' }) },
    cardDefinition: { groupBy: async () => [] },
    cardOwnership: { count: () => mockCounts.ownership(), deleteMany: (a: DeleteArgs) => mockDeletes.ownership(a) },
    packGrant:     { count: () => mockCounts.grant(),     deleteMany: (a: DeleteArgs) => mockDeletes.grant(a) },
    packOpening:   { count: () => mockCounts.opening(),   deleteMany: (a: DeleteArgs) => mockDeletes.opening(a) },
    wildcardCard:  { count: () => mockCounts.wildcard(),  deleteMany: (a: DeleteArgs) => mockDeletes.wildcard(a) },
    rosterSlot:    { count: () => mockCounts.roster(),    deleteMany: (a: DeleteArgs) => mockDeletes.roster(a) },
    starterGrant:  { count: () => mockCounts.starter(),   deleteMany: (a: DeleteArgs) => mockDeletes.starter(a) },
    packBonus:     { count: () => mockCounts.bonus(),     deleteMany: (a: DeleteArgs) => mockDeletes.bonus(a) },
    // Vanity pictures. CardPortrait is deliberately not here — it is not
    // season-scoped and the reset must never reach it.
    cardImage:     { count: () => mockCounts.image(),     deleteMany: (a: DeleteArgs) => mockDeletes.image(a) },
  },
}));

const ALLOWED = { denied: null, userId: 'user-1', role: 'MEMBER' };

function req(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000/api/cards/${path}`, init as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUser.mockResolvedValue(ALLOWED);
  mockRequireCommissioner.mockResolvedValue(null);
  mockAvailableSeasons.mockResolvedValue([2023, 2024, 2025]);
  mockClaimBonuses.mockResolvedValue({ awarded: [], kinds: [] });
});

describe('GET /api/cards/collection', () => {
  it('rejects a signed-out caller with the guard\'s own response', async () => {
    const denial = Response.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequireUser.mockResolvedValue({ denied: denial });

    const { GET } = await import('@/app/api/cards/collection/route');
    const res = await GET(req('collection'));

    expect(res.status).toBe(401);
    expect(mockReadDeck).not.toHaveBeenCalled();
  });

  it('returns the allowance, stats and cards together', async () => {
    mockReadAllowance.mockResolvedValue({ remaining: 11, week: 3 });
    mockReadDeck.mockResolvedValue({
      cards: [{ id: 'c1' }],
      stats: { cards: 1, rosterPpg: 24.5, deckAvgPpg: 7.3, started: 1 },
      roster: [{ slot: { id: 'QB', label: 'QB', accepts: ['QB'] }, card: null }],
      standings: [{ userId: 'u1', name: 'Scott', rank: 1, rosterPpg: 24.5, isYou: true }],
    });

    const { GET } = await import('@/app/api/cards/collection/route');
    const res = await GET(req('collection'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allowance.remaining).toBe(11);
    expect(body.cards).toHaveLength(1);
    expect(body.roster).toHaveLength(1);
    // Standings ride along so the page needs one request, not two.
    expect(body.standings).toHaveLength(1);
    expect(body.bonus.threshold).toBe(100);
    expect(body.seasons).toEqual([2023, 2024, 2025]);
  });

  it('reports a read failure as a 500 rather than throwing', async () => {
    mockReadAllowance.mockRejectedValue(new Error('turso is down'));
    mockReadDeck.mockResolvedValue({ cards: [], stats: {}, roster: [], standings: [] });

    const { GET } = await import('@/app/api/cards/collection/route');
    const res = await GET(req('collection'));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('turso is down');
  });
});

describe('POST /api/cards/open', () => {
  it('returns the dealt cards on success', async () => {
    mockOpenOnePack.mockResolvedValue({
      ok: true,
      result: { packTier: 'GOLD', cards: [{ id: 'a' }], newCardIds: ['a'], allowance: {} },
    });

    const { POST } = await import('@/app/api/cards/open/route');
    const res = await POST(req('open', { method: 'POST' }));

    expect(res.status).toBe(200);
    expect((await res.json()).packTier).toBe('GOLD');
  });

  // WHY: 409, not 403. The member is entitled to open packs, they are simply
  //      out of them — the UI shows "no packs left this week" off this status,
  //      and a 403 would read as an access problem.
  it('answers 409 when the weekly ration is spent', async () => {
    mockOpenOnePack.mockResolvedValue({ ok: false, reason: 'NO_PACKS' });

    const { POST } = await import('@/app/api/cards/open/route');
    const res = await POST(req('open', { method: 'POST' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no packs left/i);
  });

  // WHY: an unbuilt pool is a commissioner's job to fix, so the message has to
  //      say so rather than reporting a generic failure.
  it('explains an empty pool instead of dealing nothing', async () => {
    mockOpenOnePack.mockResolvedValue({ ok: false, reason: 'EMPTY_POOL' });

    const { POST } = await import('@/app/api/cards/open/route');
    const res = await POST(req('open', { method: 'POST' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/commissioner/i);
  });

  it('never opens a pack for a signed-out caller', async () => {
    mockRequireUser.mockResolvedValue({ denied: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const { POST } = await import('@/app/api/cards/open/route');
    const res = await POST(req('open', { method: 'POST' }));

    expect(res.status).toBe(401);
    expect(mockOpenOnePack).not.toHaveBeenCalled();
  });
});

describe('POST /api/cards/pool', () => {
  it('rebuilds for a commissioner', async () => {
    mockRebuild.mockResolvedValue({ seasons: [2025], cardsBySeason: { 2025: 623 }, total: 623 });

    const { POST } = await import('@/app/api/cards/pool/route');
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(623);
    expect(body.perWeek).toBe(10);
  });

  it('refuses a non-commissioner', async () => {
    mockRequireCommissioner.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }));

    const { POST } = await import('@/app/api/cards/pool/route');
    const res = await POST();

    expect(res.status).toBe(403);
    expect(mockRebuild).not.toHaveBeenCalled();
  });
});

describe('GET /api/cards/collection — Sleeper bonuses', () => {
  beforeEach(() => {
    mockReadAllowance.mockResolvedValue({ remaining: 12, week: 3, bonusRemaining: 2 });
    mockReadDeck.mockResolvedValue({ cards: [], stats: {}, roster: [], standings: [] });
  });

  it('reports what the check awarded, so the page can say why', async () => {
    mockClaimBonuses.mockResolvedValue({
      awarded: [{ kind: 'WIN', sleeperLeagueId: 'L1', points: 112.4 }],
      kinds: ['WIN', 'HIGH_SCORE'],
    });

    const { GET } = await import('@/app/api/cards/collection/route');
    const body = await (await GET(req('collection'))).json();

    expect(body.bonus.kinds).toEqual(['WIN', 'HIGH_SCORE']);
    expect(body.bonus.awarded[0].points).toBe(112.4);
  });

  // WHY: Sleeper is a third party and the card game does not depend on it. A
  //      member with no linked account, or an outage, must still get their deck
  //      — the bonus check is additive, never load-bearing.
  it('still returns the deck when nothing was earned', async () => {
    mockClaimBonuses.mockResolvedValue({ awarded: [], kinds: [] });

    const { GET } = await import('@/app/api/cards/collection/route');
    const res = await GET(req('collection'));

    expect(res.status).toBe(200);
    expect((await res.json()).bonus.kinds).toEqual([]);
  });
});

describe('PUT /api/cards/roster', () => {
  const put = (body: unknown) =>
    req('roster', { method: 'PUT', body: JSON.stringify(body) });

  beforeEach(() => {
    mockReadDeck.mockResolvedValue({
      cards: [],
      stats: { cards: 0, rosterPpg: 0, deckAvgPpg: 0, started: 0 },
      roster: [{ slot: { id: 'RB1', label: 'RB', accepts: ['RB'] }, card: null }],
      standings: [],
    });
  });

  it('sets a slot and returns the whole lineup back', async () => {
    mockSetRosterSlot.mockResolvedValue({ ok: true });

    const { PUT } = await import('@/app/api/cards/roster/route');
    const res = await PUT(put({ slot: 'RB1', cardId: 'card-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.roster).toHaveLength(1);
    expect(body.stats).toBeDefined();
  });

  // WHY: null is a real instruction — bench this player — so it must be
  //      distinguished from an absent field rather than folded in with it.
  it('accepts null to empty a slot', async () => {
    mockSetRosterSlot.mockResolvedValue({ ok: true });

    const { PUT } = await import('@/app/api/cards/roster/route');
    expect((await PUT(put({ slot: 'RB1', cardId: null }))).status).toBe(200);
    expect(mockSetRosterSlot).toHaveBeenCalled();
  });

  it('rejects a missing cardId rather than guessing', async () => {
    const { PUT } = await import('@/app/api/cards/roster/route');
    const res = await PUT(put({ slot: 'RB1' }));

    expect(res.status).toBe(400);
    expect(mockSetRosterSlot).not.toHaveBeenCalled();
  });

  it('rejects a request with no slot', async () => {
    const { PUT } = await import('@/app/api/cards/roster/route');
    expect((await PUT(put({ cardId: 'c1' }))).status).toBe(400);
  });

  // WHY: the three refusals map to different statuses on purpose. Playing a
  //      card you do not own is a permissions answer; the other two are
  //      malformed requests.
  it.each([
    ['UNKNOWN_SLOT', 400],
    ['WRONG_POSITION', 400],
    ['NOT_OWNED', 403],
  ])('reports %s as %i', async (reason, status) => {
    mockSetRosterSlot.mockResolvedValue({ ok: false, reason });

    const { PUT } = await import('@/app/api/cards/roster/route');
    expect((await PUT(put({ slot: 'RB1', cardId: 'c1' }))).status).toBe(status);
  });

  it('refuses a signed-out caller', async () => {
    mockRequireUser.mockResolvedValue({ denied: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const { PUT } = await import('@/app/api/cards/roster/route');
    expect((await PUT(put({ slot: 'RB1', cardId: 'c1' }))).status).toBe(401);
    expect(mockSetRosterSlot).not.toHaveBeenCalled();
  });
});

describe('POST /api/cards/wildcard', () => {
  const throwing = (id: unknown = 'wc1') =>
    req('wildcard', { method: 'POST', body: JSON.stringify({ id }) });

  it('returns the roll and the new ration', async () => {
    mockClaimWildcard.mockResolvedValue({ rolled: true, value: 4, packsGranted: 14 });

    const { POST } = await import('@/app/api/cards/wildcard/route');
    const res = await POST(throwing());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: 'wc1', rolled: true, value: 4, packsGranted: 14, week: 3 });
  });

  // WHY: a second roll is a normal outcome of a double-click, not an error.
  //      The UI shows the value that actually stuck, so it must come back 200.
  it('reports an already-thrown die without failing', async () => {
    mockClaimWildcard.mockResolvedValue({ rolled: false, value: 5, packsGranted: 15 });

    const { POST } = await import('@/app/api/cards/wildcard/route');
    const res = await POST(throwing());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rolled: false, value: 5 });
  });

  // WHY: claimWildcard returns null for an id that is not the caller's — the
  //      userId is in its where clause — and for one that never existed. A 404
  //      covers both without confirming which.
  it('404s on a wildcard the caller does not hold', async () => {
    mockClaimWildcard.mockResolvedValue(null);

    const { POST } = await import('@/app/api/cards/wildcard/route');
    expect((await POST(throwing('someone-elses'))).status).toBe(404);
  });

  it('refuses a request with no id', async () => {
    const { POST } = await import('@/app/api/cards/wildcard/route');
    const res = await POST(req('wildcard', { method: 'POST', body: JSON.stringify({}) }));

    expect(res.status).toBe(400);
    expect(mockClaimWildcard).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON at all', async () => {
    const { POST } = await import('@/app/api/cards/wildcard/route');
    const res = await POST(req('wildcard', { method: 'POST', body: 'nonsense' }));

    expect(res.status).toBe(400);
    expect(mockClaimWildcard).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    mockRequireUser.mockResolvedValue({ denied: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const { POST } = await import('@/app/api/cards/wildcard/route');
    expect((await POST(throwing())).status).toBe(401);
    expect(mockClaimWildcard).not.toHaveBeenCalled();
  });
});

describe('GET /api/cards/leaderboard', () => {
  it('returns the standings', async () => {
    mockReadLeaderboard.mockResolvedValue([
      { userId: 'u1', name: 'Scott', rank: 1, cards: 45, score: 900, isYou: true },
    ]);

    const { GET } = await import('@/app/api/cards/leaderboard/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.gameSeason).toBe(2026);
  });

  it('refuses a signed-out caller', async () => {
    mockRequireUser.mockResolvedValue({ denied: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const { GET } = await import('@/app/api/cards/leaderboard/route');
    expect((await GET()).status).toBe(401);
    expect(mockReadLeaderboard).not.toHaveBeenCalled();
  });
});

describe('POST /api/cards/reset', () => {
  const body = (season?: unknown) =>
    req('reset', { method: 'POST', body: JSON.stringify({ season }) });

  it('refuses a non-commissioner', async () => {
    mockRequireCommissioner.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    expect((await POST(body(2026))).status).toBe(403);
    expect(mockDeletes.ownership).not.toHaveBeenCalled();
  });

  // WHY: the guard that matters. A reset with no season named must not fall
  //      back to the current one — that default is what turns a stray request
  //      into every member losing their collection.
  it.each([undefined, 'not-a-year', 1900, 3000])(
    'refuses to reset when the season is %p',
    async (season) => {
      const { POST } = await import('@/app/api/cards/reset/route');
      const res = await POST(body(season));

      expect(res.status).toBe(400);
      expect(mockDeletes.ownership).not.toHaveBeenCalled();
    },
  );

  it('refuses a body that is not JSON at all', async () => {
    const { POST } = await import('@/app/api/cards/reset/route');
    const res = await POST(req('reset', { method: 'POST', body: 'nonsense' }));

    expect(res.status).toBe(400);
    expect(mockDeletes.ownership).not.toHaveBeenCalled();
  });

  /** Every counter at zero — the "nothing happened this season" baseline. */
  function noActivity() {
    Object.values(mockCounts).forEach((c) => c.mockResolvedValue(0));
  }

  it('reports 404 rather than deleting when the season is already empty', async () => {
    noActivity();

    const { POST } = await import('@/app/api/cards/reset/route');
    const res = await POST(body(2026));

    expect(res.status).toBe(404);
    expect(mockDeletes.ownership).not.toHaveBeenCalled();
  });

  // WHY: the one table the reset must NOT touch. A contributed portrait is the
  //      only face a card with no photograph anywhere will ever have; it
  //      belongs to the card rather than to a season's ownership, and next
  //      season's owner inherits it.
  //
  //      The prisma mock deliberately has no `cardPortrait`, so adding it to
  //      OWNED_TABLES makes this throw rather than quietly destroying every
  //      contribution the league has made. The assertion on the payload is the
  //      readable half; the mock is the half with teeth.
  it('never clears contributed portraits', async () => {
    noActivity();
    mockCounts.ownership.mockResolvedValue(1);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    const res = await POST(body(2026));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).not.toHaveProperty('portraits');
  });

  it('clears every owned table and reports what it destroyed', async () => {
    noActivity();
    mockCounts.ownership.mockResolvedValue(55);
    mockCounts.grant.mockResolvedValue(3);
    mockCounts.opening.mockResolvedValue(11);
    mockCounts.wildcard.mockResolvedValue(2);
    mockCounts.roster.mockResolvedValue(9);
    mockCounts.starter.mockResolvedValue(1);
    mockCounts.bonus.mockResolvedValue(4);
    mockCounts.image.mockResolvedValue(7);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    const res = await POST(body(2026));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({
      season: 2026, ownerships: 55, grants: 3, openings: 11, wildcards: 2,
      rosters: 9, starters: 1, bonuses: 4, images: 7,
    });
    // Every table, not a subset, and each scoped to the one season. The bug
    // this covers was a hand-written list that had drifted from the set of
    // season-scoped models.
    Object.values(mockDeletes).forEach((d) =>
      expect(d).toHaveBeenCalledWith({ where: { gameSeason: 2026 } }));
  });

  // WHY: the reported bug. A reset wiped every card a member owned and left
  //      their nine lineup slots pointing at cards nobody held. The standings
  //      rank on lineup points, so the scoreboard survived the reset too.
  it('clears the starting lineup', async () => {
    noActivity();
    mockCounts.ownership.mockResolvedValue(55);
    mockCounts.roster.mockResolvedValue(9);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    const res = await POST(body(2026));

    expect(res.status).toBe(200);
    expect(mockDeletes.roster).toHaveBeenCalledWith({ where: { gameSeason: 2026 } });
    expect((await res.json()).rosters).toBe(9);
  });

  // WHY: a lineup left behind is still activity. Before the fix this returned
  //      404 — "nothing to reset" — while nine stale slots sat in the table.
  it('resets a season whose only activity is a stale lineup', async () => {
    noActivity();
    mockCounts.roster.mockResolvedValue(9);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    expect((await POST(body(2026))).status).toBe(200);
    expect(mockDeletes.roster).toHaveBeenCalled();
  });

  // WHY: the welcome packs are once-per-season. Left behind, a member starting
  //      from an empty deck again would get none of the leg up a new member does.
  it('clears the one-off starter grant', async () => {
    noActivity();
    mockCounts.starter.mockResolvedValue(1);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    expect((await POST(body(2026))).status).toBe(200);
    expect(mockDeletes.starter).toHaveBeenCalled();
  });

  // WHY: PackBonus is unique on (user, season, week, kind). A row left behind
  //      permanently blocks re-earning that week's bonus after a reset.
  it('clears the Sleeper bonus ledger', async () => {
    noActivity();
    mockCounts.bonus.mockResolvedValue(4);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    expect((await POST(body(2026))).status).toBe(200);
    expect(mockDeletes.bonus).toHaveBeenCalled();
  });

  // WHY: unthrown dice are season state like any other. A reset that left them
  //      behind would hand a member free packs across a season boundary.
  it('resets a season whose only activity is an unthrown wildcard', async () => {
    noActivity();
    mockCounts.wildcard.mockResolvedValue(1);
    Object.values(mockDeletes).forEach((d) => d.mockResolvedValue({ count: 1 }));

    const { POST } = await import('@/app/api/cards/reset/route');
    expect((await POST(body(2026))).status).toBe(200);
    expect(mockDeletes.wildcard).toHaveBeenCalled();
  });
});
