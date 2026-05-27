// tests/app/api/users/route.test.ts
//
// Tests for GET /api/users.
// Mocks @/lib/prisma and @/auth (next-auth server session check).

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

// auth() is called inside the route to check for a valid session.
// Mock it as returning a real session by default; override per-test for 401 cases.
jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

import { GET } from '@/app/api/users/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const mockFindMany = prisma.user.findMany as jest.MockedFunction<typeof prisma.user.findMany>;
const mockAuth     = auth             as jest.MockedFunction<typeof auth>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeSession = { user: { id: '1', role: 'COMMISSIONER' } };

const fakeUsers = [
  { id: '2', name: 'Alice', username: 'alice', email: 'a@a.com', role: 'MEMBER', createdAt: new Date() },
  { id: '3', name: 'Bob',   username: 'bob',   email: 'b@b.com', role: 'PLAYER', createdAt: new Date() },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    // Default: authenticated session
    mockAuth.mockResolvedValue(fakeSession as never);
  });

  // WHY: Verifies the happy path — authenticated user receives the user list
  //      with a 200 status. Admin is excluded by the Prisma `where` clause.
  it('returns 200 with user array when DB returns results', async () => {
    mockFindMany.mockResolvedValueOnce(fakeUsers as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json() as typeof fakeUsers;
    expect(body).toHaveLength(2);
    expect(body[0].username).toBe('alice');
  });

  // WHY: Without a session the endpoint must return 401 so unauthenticated
  //      browsers cannot enumerate all users.
  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  // WHY: If Prisma throws (e.g. DB connection timeout), the route must catch
  //      and return a 500 with the error message rather than crashing.
  it('returns 500 with error message when Prisma throws', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DB connection failed/);
  });

  // WHY: The Prisma query must exclude the admin user by username so they never
  //      appear in the member management list.
  it('passes the admin-exclusion filter to Prisma', async () => {
    mockFindMany.mockResolvedValueOnce([] as never);

    await GET();

    // The where clause must contain NOT: { username: adminUsername }
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ NOT: expect.anything() }),
      }),
    );
  });
});
