// tests/unit/lib/cards/weekly.test.ts
//
// Covers src/lib/cards/weekly.ts — freezing a lineup, retiring what played, and
// publishing a week.
//
// The clock itself is pinned in weeklyGame.test.ts. What matters here is what
// the database is asked to do at each phase of it: that a late submission is
// refused rather than written, that a week's results cannot be read before
// their Tuesday however the week is asked for, and that a season total counts
// published weeks only — a standings table that moved at midnight would give
// the week away ten hours early.

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

type Any = Record<string, unknown>;

const db = {
  lineupCard: {
    findMany:   jest.fn<(a?: Any) => Promise<Any[]>>(),
    deleteMany: jest.fn<(a?: Any) => Promise<Any>>(),
  },
  lineupSubmission: {
    findMany:   jest.fn<(a?: Any) => Promise<Any[]>>(),
    findUnique: jest.fn<(a?: Any) => Promise<Any | null>>(),
    deleteMany: jest.fn<(a?: Any) => Promise<Any>>(),
    create:     jest.fn<(a?: Any) => Promise<Any>>(),
  },
  rosterSlot: {
    findMany:   jest.fn<(a?: Any) => Promise<Any[]>>(),
    deleteMany: jest.fn<(a?: Any) => Promise<Any>>(),
  },
  cardDefinition: { findMany: jest.fn<(a?: Any) => Promise<Any[]>>() },
  cardOwnership:  { findMany: jest.fn<(a?: Any) => Promise<Any[]>>() },
  cardImage:      { findMany: jest.fn<(a?: Any) => Promise<Any[]>>() },
  cardPortrait:   { findMany: jest.fn<(a?: Any) => Promise<Any[]>>() },
  user:           { findMany: jest.fn<(a?: Any) => Promise<Any[]>>() },
  // The array form runs its statements in order inside one transaction. The
  // mock resolves them the same way, so a test can assert on what was queued.
  $transaction: jest.fn<(ops: unknown[]) => Promise<unknown[]>>(),
};

jest.mock('@/lib/prisma', () => ({ prisma: db }));
jest.mock('@/lib/cards/eligibility', () => ({ eligiblePlayerWhere: () => ({}) }));

import {
  clearRetiredSlots, readWeeklyState, readWeekResults, retiredCards,
  seasonScores, submitLineup,
} from '@/lib/cards/weekly';
import { lockAt, revealAt } from '@/lib/cards/weeklyGame';

const SEASON = 2025;
/** Wednesday of week 3: submissions open, weeks 1 and 2 published. */
const OPEN = new Date('2025-09-17T16:00:00Z');
/** Tuesday 2am central of week 1 — past the lock, before the reveal. */
const LOCKED = new Date('2025-09-09T07:00:00Z');

const card = (id: string, ppg: number, over: Any = {}) => ({
  id, season: 2003, playerId: `p-${id}`, playerName: `Player ${id}`, position: 'RB',
  team: 'BAL', tier: 'GOLD', seasonRank: 4, fantasyPoints: 200, pointsPerGame: ppg,
  gamesPlayed: 16, jerseyNumber: 31, headshot: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.lineupCard.findMany.mockResolvedValue([]);
  db.lineupSubmission.findMany.mockResolvedValue([]);
  db.lineupSubmission.findUnique.mockResolvedValue(null);
  db.rosterSlot.findMany.mockResolvedValue([]);
  db.cardDefinition.findMany.mockResolvedValue([]);
  db.cardOwnership.findMany.mockResolvedValue([]);
  db.cardImage.findMany.mockResolvedValue([]);
  db.cardPortrait.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
});

describe('retirement', () => {
  // WHY: the games are over by Monday midnight, so the cards have played
  //      whether or not the results are out. Keying this on the reveal instead
  //      would let a member re-field Monday night's lineup for ten hours.
  it('counts a card as played from the lock, not the reveal', async () => {
    db.lineupCard.findMany.mockResolvedValue([{ cardId: 'c1', week: 1, points: 18.5 }]);

    const retired = await retiredCards('u1', SEASON, LOCKED);

    expect(retired.get('c1')).toEqual({ cardId: 'c1', week: 1, points: 18.5 });
    expect(db.lineupCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ submission: { lockAt: { lte: LOCKED } } }),
      }),
    );
  });

  // WHY: on Tuesday morning a member's slots still point at nine cards that can
  //      never start again. Left alone the lineup looks full and scores nothing.
  it('sweeps retired cards out of the lineup', async () => {
    db.lineupCard.findMany.mockResolvedValue([
      { cardId: 'c1', week: 1, points: 10 },
      { cardId: 'c2', week: 1, points: 12 },
    ]);
    db.rosterSlot.deleteMany.mockResolvedValue({ count: 2 });

    expect(await clearRetiredSlots('u1', SEASON, OPEN)).toBe(2);
    expect(db.rosterSlot.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', gameSeason: SEASON, cardId: { in: ['c1', 'c2'] } },
    });
  });

  it('touches nothing when nothing has played', async () => {
    expect(await clearRetiredSlots('u1', SEASON, OPEN)).toBe(0);
    expect(db.rosterSlot.deleteMany).not.toHaveBeenCalled();
  });
});

describe('submitting a lineup', () => {
  function lineup() {
    db.rosterSlot.findMany.mockResolvedValue([
      { slot: 'QB', cardId: 'c1' },
      { slot: 'RB1', cardId: 'c2' },
    ]);
    db.cardDefinition.findMany.mockResolvedValue([
      { id: 'c1', pointsPerGame: 21.4 },
      { id: 'c2', pointsPerGame: 15.2 },
    ]);
  }

  it('freezes the lineup, its score and the deadline it beat', async () => {
    lineup();

    const result = await submitLineup('u1', SEASON, OPEN);

    expect(result).toEqual({
      ok: true,
      result: {
        week: 3, points: 36.6, filled: 2,
        lockAt: lockAt(SEASON, 3), revealAt: revealAt(SEASON, 3),
      },
    });

    // Children deleted before the parent, then one create — see the note in
    // submitLineup about SQLite's foreign keys.
    expect(db.lineupCard.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', gameSeason: SEASON, week: 3 },
    });
    expect(db.lineupSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1', gameSeason: SEASON, week: 3, points: 36.6, filled: 2,
        lockAt: lockAt(SEASON, 3), revealAt: revealAt(SEASON, 3),
      }),
    });
    expect(db.$transaction).toHaveBeenCalled();
  });

  // WHY: the deadline is the feature. A submission after 11:59pm Monday has to
  //      be refused before anything is written, not written and then hidden.
  it('refuses a lineup sent after the Monday deadline', async () => {
    lineup();

    expect(await submitLineup('u1', SEASON, LOCKED))
      .toEqual({ ok: false, reason: 'LOCKED' });
    expect(db.lineupSubmission.create).not.toHaveBeenCalled();
  });

  it('refuses once the final week has been published', async () => {
    lineup();

    expect(await submitLineup('u1', SEASON, new Date('2026-02-01T12:00:00Z')))
      .toEqual({ ok: false, reason: 'SEASON_OVER' });
    expect(db.lineupSubmission.create).not.toHaveBeenCalled();
  });

  it('refuses an empty lineup rather than banking a zero', async () => {
    expect(await submitLineup('u1', SEASON, OPEN)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  // WHY: a stale slot is a cleanup that has not run yet, not an attempt to
  //      cheat. Submitting the rest beats refusing the whole lineup over it.
  it('drops a retired card from the lineup rather than refusing it', async () => {
    lineup();
    db.lineupCard.findMany.mockResolvedValue([{ cardId: 'c1', week: 1, points: 21.4 }]);
    db.cardDefinition.findMany.mockResolvedValue([{ id: 'c2', pointsPerGame: 15.2 }]);

    const result = await submitLineup('u1', SEASON, OPEN);

    expect(result).toMatchObject({ ok: true, result: { filled: 1, points: 15.2 } });
  });

  // WHY: retirement is enforced by the (user, season, card) index rather than
  //      by the filter above it, so the refusal has to survive arriving as a
  //      database error — and under the libSQL adapter that is raw SQLite text
  //      rather than Prisma's P2002.
  it('reports the index refusing a card that has already played', async () => {
    lineup();
    db.$transaction.mockRejectedValue(
      new Error('UNIQUE constraint failed: LineupCard.userId, LineupCard.cardId'),
    );

    expect(await submitLineup('u1', SEASON, OPEN)).toEqual({ ok: false, reason: 'RETIRED' });
  });

  it('lets anything else through as the bug it is', async () => {
    lineup();
    db.$transaction.mockRejectedValue(new Error('database is locked'));

    await expect(submitLineup('u1', SEASON, OPEN)).rejects.toThrow('database is locked');
  });

  // WHY: a card a pool rebuild removed has no points to score. Dropping it
  //      matches how the deck read treats an orphaned ownership.
  it('drops a slot whose card no longer exists', async () => {
    lineup();
    db.cardDefinition.findMany.mockResolvedValue([{ id: 'c1', pointsPerGame: 21.4 }]);

    expect(await submitLineup('u1', SEASON, OPEN))
      .toMatchObject({ ok: true, result: { filled: 1, points: 21.4 } });
  });
});

describe('the season score', () => {
  // WHY: cards retire on Monday night but nothing is published until Tuesday
  //      morning. A total that moved at midnight would give the week away.
  it('counts published weeks only', async () => {
    await seasonScores(SEASON, OPEN);

    expect(db.lineupSubmission.findMany).toHaveBeenCalledWith({
      where:  { gameSeason: SEASON, revealAt: { lte: OPEN } },
      select: { userId: true, points: true },
    });
  });

  // WHY: rounding each week and summing the results drifts from the total
  //      printed beside them, which is the kind of thing a league argues about.
  it('rounds the total once rather than every week', async () => {
    db.lineupSubmission.findMany.mockResolvedValue([
      { userId: 'u1', points: 10.05 },
      { userId: 'u1', points: 10.05 },
      { userId: 'u2', points: 4 },
    ]);

    const scores = await seasonScores(SEASON, OPEN);

    expect(scores.get('u1')).toEqual({ points: 20.1, weeks: 2 });
    expect(scores.get('u2')).toEqual({ points: 4, weeks: 1 });
  });
});

describe('reading the results', () => {
  function week1() {
    db.lineupSubmission.findMany.mockResolvedValue([
      {
        userId: 'u1', points: 30, filled: 2, submittedAt: new Date('2025-09-08T12:00:00Z'),
        cards: [
          { slot: 'QB', cardId: 'c1', points: 12 },
          { slot: 'RB1', cardId: 'c2', points: 18 },
        ],
      },
      {
        userId: 'u2', points: 40, filled: 1, submittedAt: new Date('2025-09-08T13:00:00Z'),
        cards: [{ slot: 'QB', cardId: 'c3', points: 40 }],
      },
    ]);
    db.cardDefinition.findMany.mockResolvedValue([card('c1', 12), card('c2', 18), card('c3', 40)]);
    db.user.findMany.mockResolvedValue([
      { id: 'u1', name: 'Ada', username: 'ada' },
      { id: 'u2', name: null, username: 'grace' },
    ]);
  }

  // WHY: the reveal is the feature. A route that decided this would be one
  //      guard away from leaking Sunday's lineups to anyone who typed a week
  //      number into the query string.
  it('returns nothing before that week has been published', async () => {
    week1();
    expect(await readWeekResults(SEASON, 1, 'u1', LOCKED)).toBeNull();
    // Not even the query is run.
    expect(db.lineupSubmission.findMany).not.toHaveBeenCalled();
  });

  it('ranks the members best to worst', async () => {
    week1();

    const results = await readWeekResults(SEASON, 1, 'u1', OPEN);

    expect(results?.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, 'grace', 40],
      [2, 'Ada', 30],
    ]);
    expect(results?.entries[1].isYou).toBe(true);
  });

  // WHY: "everyone's card, best to worst" is the reveal people come back for.
  //      One list across the whole league, not one list per member.
  it('lists every card anybody played, best to worst', async () => {
    week1();

    const results = await readWeekResults(SEASON, 1, 'u1', OPEN);

    expect(results?.cards.map((c) => [c.id, c.points, c.ownerName])).toEqual([
      ['c3', 40, 'grace'],
      ['c2', 18, 'Ada'],
      ['c1', 12, 'Ada'],
    ]);
  });

  // WHY: the card face is the owner's — their nickname and their photograph.
  //      Published without them, the reveal is a spreadsheet.
  it('carries the nickname and picture the owner put on a card', async () => {
    week1();
    db.cardOwnership.findMany.mockResolvedValue([{ cardId: 'c3', nickname: 'The Bus' }]);
    db.cardImage.findMany.mockResolvedValue([
      { cardId: 'c3', uploadedAt: new Date('2025-09-01T00:00:00Z') },
    ]);

    const results = await readWeekResults(SEASON, 1, 'u1', OPEN);
    const best = results!.cards[0];

    expect(best.nickname).toBe('The Bus');
    expect(best.customImage).toBe(
      `/api/cards/image?cardId=c3&v=${new Date('2025-09-01T00:00:00Z').getTime()}`,
    );
  });

  // WHY: the seeded superuser is hidden from the members page and from the
  //      standings, so it must not turn up holding the week's best card.
  it('drops a submission from an account the members page hides', async () => {
    week1();
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada', username: 'ada' }]);

    const results = await readWeekResults(SEASON, 1, 'u1', OPEN);

    expect(results?.entries.map((e) => e.userId)).toEqual(['u1']);
    expect(results?.cards.every((c) => c.ownerId === 'u1')).toBe(true);
  });
});

describe('the member\'s view of the week', () => {
  it('reports the phase, the deadline and the season so far', async () => {
    db.lineupSubmission.findMany.mockResolvedValue([{ userId: 'u1', points: 30 }]);
    db.lineupCard.findMany.mockResolvedValue([{ cardId: 'c1', week: 1, points: 30 }]);

    const state = await readWeeklyState('u1', SEASON, OPEN);

    expect(state).toMatchObject({
      week: 3,
      phase: 'OPEN',
      seasonOver: false,
      submitted: null,
      revealedWeeks: [1, 2],
      retired: 1,
      seasonPoints: 30,
      weeksPlayed: 1,
    });
    expect(state.lockLabel).toBe('Mon, Sep 22, 11:59 PM CDT');
    expect(state.revealLabel).toBe('Tue, Sep 23, 10:00 AM CDT');
  });

  it('hands back what was submitted so the page can spot an edited lineup', async () => {
    db.lineupSubmission.findUnique.mockResolvedValue({
      week: 3, submittedAt: new Date('2025-09-17T10:00:00Z'), points: 21.4, filled: 1,
      cards: [{ slot: 'QB', cardId: 'c1', points: 21.4 }],
    });

    const state = await readWeeklyState('u1', SEASON, OPEN);

    expect(state.submitted).toEqual({
      week: 3,
      submittedAt: '2025-09-17T10:00:00.000Z',
      points: 21.4,
      filled: 1,
      slots: [{ slot: 'QB', cardId: 'c1', points: 21.4 }],
    });
  });
});
