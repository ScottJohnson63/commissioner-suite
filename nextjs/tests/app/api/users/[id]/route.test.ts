// tests/app/api/users/[id]/route.test.ts
//
// Tests for PATCH /api/users/[id].
// Mocks @/lib/prisma and @/auth.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
  },
}));

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { PATCH } from '@/app/api/users/[id]/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const mockFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockUpdate     = prisma.user.update     as jest.MockedFunction<typeof prisma.user.update>;
const mockAuth       = auth                   as jest.MockedFunction<typeof auth>;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Constructs the second argument that Next.js passes to dynamic route handlers.
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Builds a PATCH request with a JSON body.
function makePatch(id: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/users/[id]', () => {
  const targetId = 'user-target';
  const callerId = 'user-caller';

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    // Default: caller is a COMMISSIONER (not the same user as target)
    mockAuth.mockResolvedValue({ user: { id: callerId, role: 'COMMISSIONER' } } as never);
  });

  // WHY: Happy path — COMMISSIONER can set any role on another user.
  it('returns 200 and updated user when COMMISSIONER patches another user', async () => {
    mockFindUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    const updatedUser = { id: targetId, name: 'Alice', username: 'alice', email: null, role: 'PLAYER', createdAt: new Date() };
    mockUpdate.mockResolvedValueOnce(updatedUser as never);

    const res = await PATCH(makePatch(targetId, { role: 'PLAYER' }), makeParams(targetId));
    expect(res.status).toBe(200);

    const body = await res.json() as typeof updatedUser;
    expect(body.role).toBe('PLAYER');
  });

  // WHY: Nobody should be able to change their own role — prevents accidental
  //      self-lock-outs where a COMMISSIONER accidentally demotes themselves.
  it('returns 400 when caller tries to change their own role', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: targetId, role: 'COMMISSIONER' } } as never);

    const res = await PATCH(makePatch(targetId, { role: 'MEMBER' }), makeParams(targetId));
    expect(res.status).toBe(400);
  });

  // WHY: An invalid role value must be rejected before any DB call is made.
  it('returns 400 for an invalid role value', async () => {
    const res = await PATCH(makePatch(targetId, { role: 'SUPERADMIN' }), makeParams(targetId));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // WHY: PLAYER-role callers must not be able to change any user's role.
  it('returns 403 for a PLAYER-role caller', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: callerId, role: 'PLAYER' } } as never);

    const res = await PATCH(makePatch(targetId, { role: 'MEMBER' }), makeParams(targetId));
    expect(res.status).toBe(403);
  });

  // WHY: When the target user is not found, the route must return 404.
  it('returns 404 when Prisma cannot find the target user', async () => {
    mockFindUnique.mockResolvedValueOnce(null as never);

    const res = await PATCH(makePatch(targetId, { role: 'PLAYER' }), makeParams(targetId));
    expect(res.status).toBe(404);
  });

  // WHY: A MEMBER cannot promote another user to COMMISSIONER — only a
  //      COMMISSIONER can assign that role.
  it('returns 403 when MEMBER tries to assign COMMISSIONER role', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: callerId, role: 'MEMBER' } } as never);

    const res = await PATCH(makePatch(targetId, { role: 'COMMISSIONER' }), makeParams(targetId));
    expect(res.status).toBe(403);
  });

  // WHY: When Prisma throws unexpectedly (e.g. DB timeout), the route should
  //      return 404 rather than crashing, per the current implementation.
  it('returns 404 when prisma.user.update throws', async () => {
    mockFindUnique.mockResolvedValueOnce({ role: 'MEMBER' } as never);
    mockUpdate.mockRejectedValueOnce(new Error('DB timeout'));

    const res = await PATCH(makePatch(targetId, { role: 'PLAYER' }), makeParams(targetId));
    expect(res.status).toBe(404);
  });
});
