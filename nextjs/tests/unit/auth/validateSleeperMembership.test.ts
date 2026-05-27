// tests/unit/auth/validateSleeperMembership.test.ts
//
// Tests for the exported validateSleeperMembership() helper in src/auth.ts.
//
// This function is the Sleeper identity-gate used on every credentials login.
// It must return null (not throw) on any error — a broken Sleeper API must
// never prevent a valid commissioner from logging in with a cached session,
// but it must also never let an ex-member authenticate without league access.
//
// Mocks:
//   global.fetch   — controls all Sleeper HTTP calls
//   @/lib/prisma   — controls the local DB league list

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: jest.fn() },
  },
}));

import { validateSleeperMembership } from '@/lib/authHelpers';
import { prisma } from '@/lib/prisma';

const mockLeagueFindMany = prisma.league.findMany as jest.MockedFunction<
  typeof prisma.league.findMany
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockFetch: jest.MockedFunction<typeof fetch>;

// Builds a 200 OK Response wrapping any JSON value.
function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

// Builds a non-OK Response (e.g. 404 from Sleeper).
function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sleeperUser = { user_id: 'sleeper-uid-1', username: 'testuser' };

// A league the user belongs to that IS also in the local DB.
const memberLeague    = { league_id: 'sleeper-league-999' };
// A league not tracked locally.
const outsideLeague   = { league_id: 'sleeper-league-000' };

// The matching DB record.
const dbLeagueMatching   = [{ sleeperLeagueId: 'sleeper-league-999' }];
const dbLeagueNoMatch    = [{ sleeperLeagueId: 'sleeper-league-111' }];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateSleeperMembership()', () => {
  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;
    mockLeagueFindMany.mockReset();
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  // WHY: If Sleeper returns a 404 for the username lookup, the user does not
  //      exist on Sleeper and must be denied — return null immediately.
  it('returns null when the Sleeper user fetch returns a non-ok status', async () => {
    mockFetch.mockResolvedValueOnce(notFound());

    const result = await validateSleeperMembership('ghost');
    expect(result).toBeNull();
    // DB should NOT be queried — we bailed out early.
    expect(mockLeagueFindMany).not.toHaveBeenCalled();
  });

  // WHY: A Sleeper user record without a user_id is malformed. Returning null
  //      here avoids a downstream crash on the league lookup.
  it('returns null when the Sleeper user response has no user_id', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ username: 'testuser' })); // no user_id

    const result = await validateSleeperMembership('testuser');
    expect(result).toBeNull();
  });

  // WHY: If the leagues fetch for the resolved user_id fails, the user may have
  //      a valid Sleeper account but we cannot verify league membership — deny.
  it('returns null when the Sleeper leagues fetch returns a non-ok status', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser)) // user OK
      .mockResolvedValueOnce(notFound());          // leagues fail

    const result = await validateSleeperMembership('testuser');
    expect(result).toBeNull();
  });

  // WHY: A user who has a Sleeper account but is not in any of the leagues
  //      registered in the local DB is an outsider — they must not get access.
  it('returns null when the user is in no tracked leagues', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser))
      .mockResolvedValueOnce(okJson([outsideLeague]));
    mockLeagueFindMany.mockResolvedValueOnce(dbLeagueNoMatch as never);

    const result = await validateSleeperMembership('testuser');
    expect(result).toBeNull();
  });

  // WHY: A user in a league that IS registered locally must get access.
  //      This is the core happy-path that gates all credentials logins.
  it('returns { userId, username } when the user is in a tracked league', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser))
      .mockResolvedValueOnce(okJson([memberLeague]));
    mockLeagueFindMany.mockResolvedValueOnce(dbLeagueMatching as never);

    const result = await validateSleeperMembership('testuser');
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('sleeper-uid-1');
    expect(result!.username).toBe('testuser');
  });

  // WHY: A user who belongs to multiple leagues — some tracked, some not —
  //      must still be admitted as long as at least one league matches.
  it('returns the user when they belong to one tracked and one untracked league', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser))
      .mockResolvedValueOnce(okJson([outsideLeague, memberLeague])); // both leagues
    mockLeagueFindMany.mockResolvedValueOnce(dbLeagueMatching as never);

    const result = await validateSleeperMembership('testuser');
    expect(result).not.toBeNull();
  });

  // WHY: If any part of the function throws unexpectedly (network, JSON parse
  //      error, DB crash), the catch block must return null — never rethrow.
  //      A broken Sleeper API must not produce a 500 on the login page.
  it('returns null and does not throw when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    await expect(validateSleeperMembership('testuser')).resolves.toBeNull();
  });

  // WHY: An empty leagues array means the user has no active leagues this
  //      season — they must be denied even if they have a Sleeper account.
  it('returns null when the user has no leagues this season', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser))
      .mockResolvedValueOnce(okJson([])); // no leagues
    mockLeagueFindMany.mockResolvedValueOnce(dbLeagueMatching as never);

    const result = await validateSleeperMembership('testuser');
    expect(result).toBeNull();
  });

  // WHY: A null leagues response from Sleeper (unusual but possible API quirk)
  //      must be handled gracefully — `(null ?? []).some(...)` produces false.
  it('returns null when the leagues response is null', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(sleeperUser))
      .mockResolvedValueOnce(okJson(null)); // null leagues
    mockLeagueFindMany.mockResolvedValueOnce(dbLeagueMatching as never);

    const result = await validateSleeperMembership('testuser');
    expect(result).toBeNull();
  });
});
