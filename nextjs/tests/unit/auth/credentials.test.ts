// tests/unit/auth/credentials.test.ts
//
// Tests for authorizeCredentials() in src/lib/authHelpers.ts.
//
// authorizeCredentials() is the core login gate for the commissioner's
// username+password flow. It runs on every credentials sign-in attempt.
//
// Mocking strategy:
//   @/lib/prisma  — controls DB user/league lookups
//   bcryptjs      — controls password comparison result
//   global.fetch  — controls Sleeper API responses
//
// We do NOT mock validateSleeperMembership directly because both functions live
// in the same module. Jest's module mock intercepts cross-module calls only;
// intra-module calls bypass it. Controlling fetch achieves the same isolation
// without requiring production-code changes.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Both user (for authorize) and league (for the internal validateSleeper call)
// tables need to be mocked — they're reached by different functions in the same
// module, but both go through the same prisma singleton.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    league: {
      findMany: jest.fn(),
    },
  },
}));

// bcryptjs.compare controls whether the password check passes or fails.
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

import { authorizeCredentials } from '@/lib/authHelpers';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

const mockFindUnique    = prisma.user.findUnique   as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockUpdate        = prisma.user.update       as jest.MockedFunction<typeof prisma.user.update>;
const mockLeagueFindMany = prisma.league.findMany  as jest.MockedFunction<typeof prisma.league.findMany>;
const mockBcryptCompare = bcrypt.compare           as jest.MockedFunction<typeof bcrypt.compare>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A DB user record with a password hash and a linked Sleeper user ID.
const fakeDbUser = {
  id:            'user-db-1',
  username:      'commissioner',
  name:          'Commissioner',
  email:         'comm@example.com',
  image:         null,
  password:      '$2a$10$hashedpassword',
  sleeperUserId: 'sleeper-uid-1',
};

// Sleeper API responses that represent a valid, in-league user.
const sleeperUserResponse   = { user_id: 'sleeper-uid-1', username: 'commissioner' };
const sleeperLeagueResponse = [{ league_id: 'sleeper-league-999' }];
const dbLeagueRecord        = [{ sleeperLeagueId: 'sleeper-league-999' }];

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockFetch: jest.MockedFunction<typeof fetch>;

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}
function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

// Queues the two Sleeper fetch responses required for a successful membership check:
// 1. GET /user/{username} → returns sleeperUser object
// 2. GET /user/{userId}/leagues/nfl/{season} → returns leagues array
function setupSleeperSuccess(userId = 'sleeper-uid-1', username = 'commissioner'): void {
  mockFetch
    .mockResolvedValueOnce(okJson({ user_id: userId, username }))
    .mockResolvedValueOnce(okJson(sleeperLeagueResponse));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authorizeCredentials()', () => {
  beforeEach(() => {
    // Install the fetch spy fresh each test so queued values don't bleed over.
    mockFetch = jest.spyOn(global, 'fetch') as jest.MockedFunction<typeof fetch>;

    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockBcryptCompare.mockReset();
    mockLeagueFindMany.mockReset();

    // Stable defaults shared by all happy-path tests.
    mockFindUnique.mockResolvedValue(fakeDbUser as never);
    mockBcryptCompare.mockResolvedValue(true as never);
    mockUpdate.mockResolvedValue({} as never);
    // League DB record that matches the Sleeper league fixture above.
    mockLeagueFindMany.mockResolvedValue(dbLeagueRecord as never);
  });

  afterEach(() => {
    // Restore original fetch so other tests are not affected.
    mockFetch.mockRestore();
  });

  // WHY: Missing username is the most common misuse — browsers may submit the
  //      form before the fields are populated. Must return null, not throw.
  it('returns null when username is missing', async () => {
    const result = await authorizeCredentials({ username: '', password: 'pw' });
    expect(result).toBeNull();
    // DB must NOT be queried — gate at validation before any IO.
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // WHY: Missing password is the same class of error as missing username.
  it('returns null when password is missing', async () => {
    const result = await authorizeCredentials({ username: 'commissioner', password: '' });
    expect(result).toBeNull();
  });

  // WHY: undefined credentials (e.g. NextAuth calling authorize with no form data)
  //      must also return null safely.
  it('returns null when credentials are undefined', async () => {
    const result = await authorizeCredentials(undefined);
    expect(result).toBeNull();
  });

  // WHY: If the username does not exist in the DB, the user is not registered —
  //      deny immediately without leaking whether the account exists.
  it('returns null when the user is not found in the DB', async () => {
    mockFindUnique.mockResolvedValueOnce(null as never);

    const result = await authorizeCredentials({ username: 'nobody', password: 'pw' });
    expect(result).toBeNull();
    // Password comparison must NOT run — we don't even have a hash to compare.
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  // WHY: A DB user without a password hash (e.g. an OAuth-only account) cannot
  //      use credentials login — deny rather than crash on bcrypt.compare(pw, null).
  it('returns null when the DB user has no password hash', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeDbUser, password: null } as never);

    const result = await authorizeCredentials({ username: 'commissioner', password: 'pw' });
    expect(result).toBeNull();
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  // WHY: A wrong password must produce null, not an error. This is the standard
  //      bcrypt comparison failure path — bcrypt.compare returns false.
  it('returns null when the password does not match', async () => {
    mockBcryptCompare.mockResolvedValueOnce(false as never);

    const result = await authorizeCredentials({ username: 'commissioner', password: 'wrong' });
    expect(result).toBeNull();
    // Sleeper fetch must NOT run — we fail fast after password failure.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // WHY: Valid credentials but no Sleeper league membership means the user left
  //      the league. They must lose access immediately on their next login.
  //      We simulate this by making the Sleeper user lookup return a 404.
  it('returns null when the user is not in a tracked Sleeper league', async () => {
    mockFetch.mockResolvedValueOnce(notFound());

    const result = await authorizeCredentials({ username: 'commissioner', password: 'correct' });
    expect(result).toBeNull();
  });

  // WHY: The happy path — valid credentials AND active Sleeper membership must
  //      return the minimal user object that NextAuth stores in the JWT.
  it('returns the user object when credentials and Sleeper membership are valid', async () => {
    setupSleeperSuccess();

    const result = await authorizeCredentials({ username: 'commissioner', password: 'correct' });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('user-db-1');
    expect(result!.name).toBe('Commissioner');
    expect(result!.email).toBe('comm@example.com');
  });

  // WHY: The Sleeper user ID stored in the DB might be stale (user changed their
  //      Sleeper account). When validateSleeperMembership returns a different
  //      userId, we must update the DB so future logins use the correct ID.
  it('calls prisma.user.update when the Sleeper userId has changed', async () => {
    // Sleeper returns a different userId than what's in the DB.
    setupSleeperSuccess('sleeper-uid-NEW');

    await authorizeCredentials({ username: 'commissioner', password: 'correct' });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'user-db-1' },
      data:  { sleeperUserId: 'sleeper-uid-NEW' },
    });
  });

  // WHY: When the DB sleeperUserId already matches the Sleeper response, there
  //      is no need to write to the DB — update must NOT be called.
  it('does not call prisma.user.update when the Sleeper userId is unchanged', async () => {
    // setupSleeperSuccess uses 'sleeper-uid-1' by default — same as fakeDbUser.
    setupSleeperSuccess();

    await authorizeCredentials({ username: 'commissioner', password: 'correct' });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // WHY: The sleeperLookup falls back to the stored username if sleeperUserId
  //      is null — this covers the case where the user hasn't linked Sleeper yet.
  //      With no sleeperUserId, the username is passed to validateSleeperMembership,
  //      which calls Sleeper's GET /user/{username} endpoint. We verify this by
  //      checking the fetch URL contains the username (not a user ID).
  it('falls back to username for Sleeper lookup when sleeperUserId is null', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeDbUser, sleeperUserId: null } as never);
    setupSleeperSuccess();

    const result = await authorizeCredentials({ username: 'commissioner', password: 'correct' });

    // Sleeper was reached — the username lookup path ran.
    expect(mockFetch).toHaveBeenCalled();
    // The first fetch call must use the username (not a user ID) for the lookup.
    const firstUrl = (mockFetch.mock.calls[0][0] as string);
    expect(firstUrl).toContain('/user/commissioner');
    // Login must succeed — the username fallback path is valid.
    expect(result).not.toBeNull();
  });
});
