// tests/unit/lib/api.test.ts
//
// Covers the response helpers in src/lib/api.ts, and `fail` in particular.
//
// `fail` exists because of one incident: a member opened the Draft Deck and was
// shown "BLOCKED: Operation was blocked: SQL read operations are forbidden
// (reads are blocked, do you need to upgrade your plan?)" — Turso's own text,
// billing prompt included, rendered in the app's error panel. Every route had
// a catch-all returning `error.message` straight to the browser.
//
// So the property under test is a negative one: whatever was thrown, it does
// not come out the other side. Negative properties rot quietly, which is why
// each case below names the shape of thing it is keeping out.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ok, err, fail, safeMessage, DB_UNAVAILABLE } from '@/lib/api';
import { PublicError } from '@/lib/publicError';
import { ScheduleError } from '@/lib/scheduler/types';

/** The body of a helper's response. */
async function body(res: Response): Promise<{ error: string }> {
  return await res.json() as { error: string };
}

beforeEach(() => {
  // fail() logs the real error for whoever is debugging. That is the point of
  // it, but it would otherwise spray the test output.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ok() and err()', () => {
  it('sends a payload at 200 by default', async () => {
    const res = ok({ cards: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: 3 });
  });

  it('keeps err() literal — it is for messages the caller chose', async () => {
    const res = err('Nicknames are at most 40 characters', 400);
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('Nicknames are at most 40 characters');
  });
});

describe('fail()', () => {
  // WHY: the whole reason this helper exists. A thrown message can name tables,
  //      columns, file paths and third-party services; none of that is the
  //      member's business and some of it is nobody's but ours.
  it('never lets a thrown message reach the body', async () => {
    const res = fail(new Error('SQLITE_ERROR: no such column: CardDefinition.tier'),
                     'Failed to read collection');

    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe('Failed to read collection');
  });

  // WHY: the incident itself, pinned. Turso prefixes a quota block with
  //      "BLOCKED:", and that is worth telling apart from a bug — it is not the
  //      member's fault and it will come back on its own.
  it('names the outage when Turso has blocked the database', async () => {
    const res = fail(
      new Error('BLOCKED: Operation was blocked: SQL read operations are forbidden '
              + '(reads are blocked, do you need to upgrade your plan?)'),
      'Failed to read collection',
    );

    const { error } = await body(res);
    expect(error).toBe(DB_UNAVAILABLE);
    expect(error).not.toMatch(/upgrade your plan/);
    expect(error).not.toMatch(/BLOCKED/);
  });

  // WHY: the same outage reaches the app as a Prisma startup failure when the
  //      URL is wrong or the database cannot be reached at all.
  it.each(['PrismaClientInitializationError', 'PrismaClientRustPanicError'])(
    'names the outage for %s', async (name) => {
      const error = new Error('Can\'t reach database server at aws-eu-west-1');
      error.name = name;

      expect((await body(fail(error, 'Failed to fetch users'))).error).toBe(DB_UNAVAILABLE);
    },
  );

  // WHY: an ordinary Prisma query error is a bug in our code, not an outage.
  //      Calling it "temporarily unavailable" would send somebody away to wait
  //      for a fault that is never going to clear on its own.
  it('does not call an ordinary query failure an outage', async () => {
    const error = new Error('Unique constraint failed');
    error.name = 'PrismaClientKnownRequestError';

    expect((await body(fail(error, 'Failed to open pack'))).error).toBe('Failed to open pack');
  });

  // WHY: a throw is not always an Error. `throw 'oops'` and a rejected promise
  //      carrying a plain object both land here, and neither may be stringified
  //      into the response.
  it.each([
    ['a string', 'BLOCKED: reads are blocked'],
    ['a null', null],
    ['an object', { message: 'BLOCKED: reads are blocked' }],
  ])('falls back to the caller\'s message for %s', async (_label, thrown) => {
    expect((await body(fail(thrown, 'Failed to roll'))).error).toBe('Failed to roll');
  });

  // WHY: the Sleeper routes read a 404 off the error before discarding it, so
  //      the status has to pass through untouched.
  it('passes the status through', () => {
    expect(fail(new Error('x'), 'Sleeper has no such league', 404).status).toBe(404);
    expect(fail(new Error('x'), 'Upstream error', 502).status).toBe(502);
  });

  // WHY: the message is dropped from the response, not from existence. A 500
  //      nobody can diagnose is its own kind of bug.
  it('logs the real error for whoever has to debug it', () => {
    const thrown = new Error('SQLITE_ERROR: no such table: CardDefinition');
    fail(thrown, 'Failed to read collection');

    expect(console.error).toHaveBeenCalledWith(
      '[api]', 'Failed to read collection', '—', thrown,
    );
  });
});

describe('fail() and PublicError', () => {
  // WHY: the other half of the rule. Dropping every thrown message would take
  //      the deliberate ones with it, and "Generation failed" tells a
  //      commissioner nothing they can act on. Exposure is opt-in and carried
  //      by the type — see lib/publicError.ts.
  it('passes a PublicError message through untouched', async () => {
    const res = fail(new PublicError('Expected 2 divisions, league has 3'),
                     'League sync failed');

    expect((await body(res)).error).toBe('Expected 2 divisions, league has 3');
  });

  // WHY: ScheduleError is the domain error that made this necessary — a
  //      commissioner generating a schedule for the wrong number of teams needs
  //      the count, not "Generation failed".
  it('passes a ScheduleError through, since it is one', async () => {
    expect(new ScheduleError('x')).toBeInstanceOf(PublicError);
    expect((await body(fail(new ScheduleError('Expected 10 teams, got 9'), 'Generation failed'))).error)
      .toBe('Expected 10 teams, got 9');
  });

  // WHY: the marker is about intent, not about escaping the rules. A subclass
  //      is a promise that the message was written for a stranger to read, so
  //      an ordinary Error carrying the same text is still summarised.
  it('does not pass an ordinary Error with the same text', async () => {
    expect((await body(fail(new Error('Expected 10 teams, got 9'), 'Generation failed'))).error)
      .toBe('Generation failed');
  });
});

describe('safeMessage()', () => {
  // WHY: used by the sync routes, which answer with a body of their own because
  //      the partial results matter. Same classification, no response.
  it('classifies without building a response', () => {
    expect(safeMessage(new Error('BLOCKED: nope'), 'League sync failed')).toBe(DB_UNAVAILABLE);
    expect(safeMessage(new Error('boom'), 'League sync failed')).toBe('League sync failed');
  });
});
