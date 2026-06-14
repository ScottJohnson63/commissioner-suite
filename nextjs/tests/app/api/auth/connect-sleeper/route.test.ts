// tests/app/api/auth/connect-sleeper/route.test.ts
//
// POST /api/auth/connect-sleeper
//
// Two authentication paths:
//   Path A — New OAuth user (pendingOAuth: true): validates Sleeper membership,
//             creates User+Account records in a DB transaction, returns { userId }.
//   Path B — Existing user reconnecting: updates sleeperUserId on their DB record.
//             Commissioners skip Sleeper membership validation.
//
// Mocks:
//   next-auth/jwt  — getToken (controls what JWT the request carries)
//   @/auth         — validateSleeperMembership
//   @/lib/prisma   — account.findUnique, user.create, user.findUnique, user.update,
//                    $transaction

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// getToken is ESM-only in next-auth/jwt — mock the whole package.
jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

// validateSleeperMembership is re-exported from @/auth — mock the package so
// the ESM import chain is never traversed.
jest.mock('@/auth', () => ({
  validateSleeperMembership: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    account:  { findUnique: jest.fn(), create: jest.fn() },
    user:     { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  },
}));

import { POST } from '@/app/api/auth/connect-sleeper/route';
import { getToken } from 'next-auth/jwt';
import { validateSleeperMembership } from '@/auth';
import { prisma } from '@/lib/prisma';

const mockGetToken    = getToken                    as jest.MockedFunction<typeof getToken>;
const mockValidate    = validateSleeperMembership   as jest.MockedFunction<typeof validateSleeperMembership>;
const mockAcctFind    = prisma.account.findUnique   as jest.MockedFunction<typeof prisma.account.findUnique>;
const mockAcctCreate  = prisma.account.create       as jest.MockedFunction<typeof prisma.account.create>;
const mockUserCreate  = prisma.user.create          as jest.MockedFunction<typeof prisma.user.create>;
const mockUserFind    = prisma.user.findUnique      as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockUserUpdate  = prisma.user.update          as jest.MockedFunction<typeof prisma.user.update>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

// A pending OAuth token (Path A) — user has signed in with Discord but not yet
// linked a Sleeper account. The JWT is marked pendingOAuth: true.
const pendingToken = {
  pendingOAuth:            true,
  pendingProvider:         'discord',
  pendingProviderAccountId: 'discord-acc-1',
  pendingName:             'Alice',
  pendingEmail:            'alice@example.com',
  pendingImage:            null,
};

// A fully resolved token (Path B) — existing credentials/OAuth user.
const resolvedToken = {
  pendingOAuth: false,
  id:           'user-db-1',
};

const sleeperOk = { userId: 'sleeper-uid-1', username: 'alicesleeper' };

const existingDbUser = {
  id: 'user-db-1', role: 'MEMBER', username: 'alicesleeper', sleeperUserId: 'sleeper-uid-1',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost/api/auth/connect-sleeper', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/connect-sleeper', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockValidate.mockReset();
    mockAcctFind.mockReset();
    mockAcctCreate.mockReset();
    mockUserCreate.mockReset();
    mockUserFind.mockReset();
    mockUserUpdate.mockReset();
  });

  // ── Common guards ──────────────────────────────────────────────────────────

  // WHY: No token means the request is unauthenticated — must return 401
  //      immediately without touching Sleeper or the DB.
  it('returns 401 when no JWT token is present', async () => {
    mockGetToken.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ sleeperUsername: 'alice' }));
    expect(res.status).toBe(401);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  // WHY: A missing sleeperUsername would cause validateSleeperMembership to be
  //      called with an empty string — fail early with 400 instead.
  it('returns 400 when sleeperUsername is missing from the body', async () => {
    mockGetToken.mockResolvedValueOnce(pendingToken as never);

    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when sleeperUsername is an empty string', async () => {
    mockGetToken.mockResolvedValueOnce(pendingToken as never);

    const res = await POST(makeReq({ sleeperUsername: '   ' }));
    expect(res.status).toBe(400);
  });

  // ── Path A: New OAuth user (pendingOAuth: true) ────────────────────────────

  // WHY: A pending OAuth user whose Sleeper name isn't in any registered league
  //      must be denied (403) — they haven't proved they belong to the league.
  it('[Path A] returns 403 when Sleeper membership is invalid', async () => {
    mockGetToken.mockResolvedValueOnce(pendingToken as never);
    mockValidate.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ sleeperUsername: 'outsider' }));
    expect(res.status).toBe(403);
  });

  // WHY: A missing provider in the pending token is a corrupted state — the
  //      user must sign in again rather than getting stuck with a partial record.
  it('[Path A] returns 400 when pending provider data is missing from token', async () => {
    mockGetToken.mockResolvedValueOnce({
      pendingOAuth: true,
      // provider and providerAccountId are deliberately absent
    } as never);
    mockValidate.mockResolvedValueOnce(sleeperOk);

    const res = await POST(makeReq({ sleeperUsername: 'alice' }));
    expect(res.status).toBe(400);
  });

  // WHY: If the Account record was already created (a race condition), the route
  //      must NOT create a duplicate — instead return the existing userId so the
  //      client can refresh its session.
  it('[Path A] returns 200 with existing userId when account already exists (race guard)', async () => {
    mockGetToken.mockResolvedValueOnce(pendingToken as never);
    mockValidate.mockResolvedValueOnce(sleeperOk);
    // Account already exists — someone beat us to it
    mockAcctFind.mockResolvedValueOnce({ userId: 'user-db-existing' } as never);

    const res = await POST(makeReq({ sleeperUsername: 'alice' }));
    // ok() returns data directly (no { data: ... } wrapper)
    const json = await res.json() as { ok: boolean; userId: string };

    expect(res.status).toBe(200);
    expect(json.userId).toBe('user-db-existing');
    // User/Account create must NOT have been called — we short-circuit on the race.
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(mockAcctCreate).not.toHaveBeenCalled();
  });

  // WHY: The happy Path A creates a User then Account sequentially and returns
  //      { ok: true, userId } so the client can trigger session.update().
  it('[Path A] creates user+account and returns userId', async () => {
    mockGetToken.mockResolvedValueOnce(pendingToken as never);
    mockValidate.mockResolvedValueOnce(sleeperOk);
    mockAcctFind.mockResolvedValueOnce(null); // no existing account
    mockUserCreate.mockResolvedValueOnce({ id: 'user-new-1' } as never);
    mockAcctCreate.mockResolvedValueOnce({} as never);

    const res = await POST(makeReq({ sleeperUsername: 'alice' }));
    const json = await res.json() as { ok: boolean; userId: string };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.userId).toBe('user-new-1');
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockAcctCreate).toHaveBeenCalledTimes(1);
  });

  // ── Path B: Existing user reconnecting ────────────────────────────────────

  // WHY: A resolved token with an id that doesn't match any DB user means the
  //      account was deleted — must return 404 rather than crash on a null dereference.
  it('[Path B] returns 404 when the user is not found in the DB', async () => {
    mockGetToken.mockResolvedValueOnce(resolvedToken as never);
    mockUserFind.mockResolvedValueOnce(null as never);

    const res = await POST(makeReq({ sleeperUsername: 'alice' }));
    expect(res.status).toBe(404);
  });

  // WHY: Commissioners (role: COMMISSIONER) skip Sleeper membership validation —
  //      they are trusted by their role and shouldn't be locked out if their
  //      Sleeper account isn't in a registered league.
  it('[Path B] skips Sleeper validation for COMMISSIONER role', async () => {
    mockGetToken.mockResolvedValueOnce(resolvedToken as never);
    mockUserFind.mockResolvedValueOnce({ ...existingDbUser, role: 'COMMISSIONER' } as never);

    const res = await POST(makeReq({ sleeperUsername: 'commissioner-alice' }));

    expect(res.status).toBe(200);
    // validateSleeperMembership must NOT have been called.
    expect(mockValidate).not.toHaveBeenCalled();
  });

  // WHY: A non-commissioner member must pass Sleeper validation on reconnect —
  //      deny if they are no longer in any registered league.
  it('[Path B] returns 403 when a MEMBER has invalid Sleeper membership', async () => {
    mockGetToken.mockResolvedValueOnce(resolvedToken as never);
    mockUserFind.mockResolvedValueOnce(existingDbUser as never);
    mockValidate.mockResolvedValueOnce(null);

    const res = await POST(makeReq({ sleeperUsername: 'outsider' }));
    expect(res.status).toBe(403);
  });

  // WHY: On successful reconnect for a MEMBER, the user's sleeperUserId is
  //      updated in the DB and the response includes { ok: true, userId }.
  it('[Path B] updates sleeperUserId and returns ok for a valid MEMBER reconnect', async () => {
    mockGetToken.mockResolvedValueOnce(resolvedToken as never);
    mockUserFind.mockResolvedValueOnce(existingDbUser as never);
    mockValidate.mockResolvedValueOnce(sleeperOk);
    mockUserUpdate.mockResolvedValueOnce(existingDbUser as never);

    const res = await POST(makeReq({ sleeperUsername: 'alicesleeper' }));
    // ok() returns data directly (no { data: ... } wrapper)
    const json = await res.json() as { ok: boolean; userId: string };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-db-1' },
    }));
  });
});
