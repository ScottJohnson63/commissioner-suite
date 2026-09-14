// tests/unit/lib/apiAuth.test.ts
//
// Covers src/lib/apiAuth.ts — the shared role guards.
//
// Four routes open with the same commissioner check. Centralising it means one
// mistake here would open all four at once, so the guards are pinned tightly:
// the only thing that passes is the exact COMMISSIONER role.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { requireCommissioner, requireMember, requireSession, requireUser, denyPending } from '@/lib/apiAuth';
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

describe('requireMember()', () => {
  beforeEach(() => { mockAuth.mockReset(); });

  // WHY: the line this guard draws is PLAYER | MEMBER, not signed-out | signed-in.
  //      A PLAYER is a real account — it just has no commissioner page to call
  //      the schedule, standings and league-teams reads from.
  it('returns null for a member', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'MEMBER' } });
    expect(await requireMember()).toBeNull();
  });

  it('returns null for a commissioner, who outranks a member', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'COMMISSIONER' } });
    expect(await requireMember()).toBeNull();
  });

  it('returns 403 for a player', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'PLAYER' } });
    const res = await requireMember();
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await requireMember())?.status).toBe(403);
  });

  it('returns 403 when the session has no role', async () => {
    mockAuth.mockResolvedValue({ user: {} });
    expect((await requireMember())?.status).toBe(403);
  });
});

describe('requireUser()', () => {
  beforeEach(() => { mockAuth.mockReset(); });

  it('hands back the id and role for a signed-in user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'PLAYER' } });
    const guard = await requireUser();
    expect(guard.denied).toBeNull();
    expect(guard.userId).toBe('u1');
    expect(guard.role).toBe('PLAYER');
  });

  it('returns 401 when signed out', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await requireUser()).denied?.status).toBe(401);
  });
});

// ── The pending-OAuth gate ────────────────────────────────────────────────────
//
// A user who has completed Discord/Google OAuth but has NOT yet proved Sleeper
// league membership holds a real, signed session. src/proxy.ts turns them back
// at /auth/connect-sleeper, but `config.matcher` excludes /api, so the proxy is
// not what keeps them out of the data — these guards are.
//
// Before this was fixed the session callback handed such a caller the role
// MEMBER, so requireSession() passed on the strength of a truthy session and
// requireMember() passed on the role. That put every member's email address
// (/api/users) and the full audit log (/api/audit) behind nothing more than a
// throwaway Discord account.
//
// Two independent locks are asserted here:
//   1. the role is the non-matching sentinel PENDING (see src/auth.ts), and
//   2. every guard rejects pendingOAuth outright, whatever the role says.
// (2) is what these tests exist for — it is the one that survives someone
// changing the sentinel back.

describe('the pendingOAuth gate', () => {
  beforeEach(() => { mockAuth.mockReset(); });

  // The session an un-admitted OAuth caller actually carries: empty id, the
  // PENDING sentinel, and the flag itself.
  const pendingSession = {
    user: { id: '', role: 'PENDING', pendingOAuth: true },
  };

  it('gives requireSession() a 403, not a pass', async () => {
    mockAuth.mockResolvedValue(pendingSession);
    const res = await requireSession();
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('gives requireMember() a 403', async () => {
    mockAuth.mockResolvedValue(pendingSession);
    expect((await requireMember())?.status).toBe(403);
  });

  it('gives requireCommissioner() a 403', async () => {
    mockAuth.mockResolvedValue(pendingSession);
    expect((await requireCommissioner())?.status).toBe(403);
  });

  it('gives requireUser() a 403 and no userId', async () => {
    mockAuth.mockResolvedValue(pendingSession);
    const guard = await requireUser();
    expect(guard.denied?.status).toBe(403);
    expect(guard.userId).toBeUndefined();
  });

  // WHY: the flag is the authority, not the role. If someone later restores a
  //      privileged role for pending sessions — the exact regression this is
  //      guarding — the guards must still refuse. 403 rather than the 401 an
  //      empty id would have produced is the proof that the flag fired.
  it('refuses even when the session claims a privileged role', async () => {
    const forged = { user: { id: 'u1', role: 'COMMISSIONER', pendingOAuth: true } };
    mockAuth.mockResolvedValue(forged);
    expect((await requireSession())?.status).toBe(403);
    mockAuth.mockResolvedValue(forged);
    expect((await requireMember())?.status).toBe(403);
    mockAuth.mockResolvedValue(forged);
    expect((await requireCommissioner())?.status).toBe(403);
    mockAuth.mockResolvedValue(forged);
    expect((await requireUser()).denied?.status).toBe(403);
  });

  // WHY: pendingOAuth is false on every admitted session, and absent on the
  //      mocked sessions above. Neither may be read as pending.
  it('lets an admitted session through when the flag is false', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'MEMBER', pendingOAuth: false } });
    expect(await requireMember()).toBeNull();
  });
});

describe('denyPending()', () => {
  // Exported for the agent route and PATCH /api/users/[id], which hold their
  // own auth() result and would otherwise have to restate the rule.
  it('returns 403 for a pending session and null for everything else', () => {
    expect(denyPending({ user: { pendingOAuth: true } } as never)?.status).toBe(403);
    expect(denyPending({ user: { pendingOAuth: false } } as never)).toBeNull();
    expect(denyPending({ user: {} } as never)).toBeNull();
    expect(denyPending(null)).toBeNull();
  });
});
