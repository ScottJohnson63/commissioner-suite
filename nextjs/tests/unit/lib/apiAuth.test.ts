// tests/unit/lib/apiAuth.test.ts
//
// Covers src/lib/apiAuth.ts — the shared role guards.
//
// Four routes open with the same commissioner check. Centralising it means one
// mistake here would open all four at once, so the guards are pinned tightly:
// the only thing that passes is the exact COMMISSIONER role.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { requireCommissioner, requireSession } from '@/lib/apiAuth';
import { auth } from '@/auth';

const mockAuth = auth as unknown as jest.MockedFunction<() => Promise<unknown>>;

describe('requireCommissioner()', () => {
  beforeEach(() => { mockAuth.mockReset(); });

  it('returns null for a commissioner, letting the handler proceed', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'COMMISSIONER' } });
    expect(await requireCommissioner()).toBeNull();
  });

  it('returns 403 for a member', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'MEMBER' } });
    const res = await requireCommissioner();
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns 403 for a player', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'PLAYER' } });
    expect((await requireCommissioner())?.status).toBe(403);
  });

  // WHY: a signed-out caller has no session at all. Returning 403 rather than
  //      401 matches what all four routes did before centralising.
  it('returns 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await requireCommissioner())?.status).toBe(403);
  });

  it('returns 403 when the session has no role', async () => {
    mockAuth.mockResolvedValue({ user: {} });
    expect((await requireCommissioner())?.status).toBe(403);
  });
});

describe('requireSession()', () => {
  beforeEach(() => { mockAuth.mockReset(); });

  // WHY: GET /api/leagues needs a session but no particular role — every
  //      signed-in user needs the allowlist to know what league they are in.
  it('returns null for any signed-in user regardless of role', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'PLAYER' } });
    expect(await requireSession()).toBeNull();
  });

  it('returns 401 when signed out', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await requireSession();
    expect(res?.status).toBe(401);
    await expect(res?.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
