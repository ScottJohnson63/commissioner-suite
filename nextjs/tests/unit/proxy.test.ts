// tests/unit/proxy.test.ts
//
// The proxy is the only thing standing between a signed-out visitor and every
// page in the app, so the public allowlist is worth pinning down exactly —
// "Statistics and News are public" must not quietly become "the app is public".

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const authMock = jest.fn<() => Promise<unknown>>();

jest.mock('@/auth', () => ({ auth: authMock }));

import { proxy } from '@/proxy';

/** Minimal stand-in for the NextRequest fields the proxy reads. */
function request(pathname: string) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return { nextUrl: url, url: url.toString() } as unknown as Parameters<typeof proxy>[0];
}

/** The redirect target, or null when the request was allowed through. */
function redirectedTo(res: { status: number; headers: Headers }): string | null {
  const location = res.headers.get('location');
  return location ? new URL(location).pathname : null;
}

describe('proxy', () => {
  beforeEach(() => { authMock.mockReset(); });

  describe('signed out', () => {
    beforeEach(() => { authMock.mockResolvedValue(null); });

    // `/` is allowed through so its own page component can redirect to the
    // dashboard — the app opens there rather than on a login wall.
    it.each(['/', '/login', '/league/dashboard'])('allows %s', async (path) => {
      expect(redirectedTo(await proxy(request(path)))).toBeNull();
    });

    // WHY: These are the pages the dashboard's own tab gating does not cover.
    //      If the proxy lets them through, hiding the tabs achieves nothing.
    it.each([
      '/league/league-sync',
      '/league/stats-sync',
      '/league/members',
      '/league/log',
      '/league/ai',
      '/assoc',
    ])('redirects %s to the login page', async (path) => {
      expect(redirectedTo(await proxy(request(path)))).toBe('/login');
    });

    // WHY: A public *prefix* would expose /league/dashboard/anything. The
    //      allowlist is an exact-match Set, and this is what proves it.
    it('does not treat a path under the dashboard as public', async () => {
      expect(redirectedTo(await proxy(request('/league/dashboard/secret')))).toBe('/login');
    });
  });

  describe('pending OAuth', () => {
    beforeEach(() => {
      authMock.mockResolvedValue({ user: { id: 'u1', pendingOAuth: true } });
    });

    it('allows the Sleeper verification page', async () => {
      expect(redirectedTo(await proxy(request('/auth/connect-sleeper')))).toBeNull();
    });

    // WHY: Public-for-signed-out must not widen into public-for-half-signed-in;
    //      a pending user still has to finish verification first.
    it('sends a pending user to verification even from the public dashboard', async () => {
      expect(redirectedTo(await proxy(request('/league/dashboard'))))
        .toBe('/auth/connect-sleeper');
    });
  });

  // A signed-in user with no Sleeper link is funnelled to the same page as a
  // pending OAuth user — otherwise clearing sleeperUserId just yields a
  // dashboard with no data and no way to fix it.
  describe('signed in without a Sleeper link', () => {
    beforeEach(() => {
      authMock.mockResolvedValue({
        user: { id: 'u1', pendingOAuth: false, sleeperUserId: null },
      });
    });

    it('allows the connect page itself, so the redirect cannot loop', async () => {
      expect(redirectedTo(await proxy(request('/auth/connect-sleeper')))).toBeNull();
    });

    it.each(['/league/dashboard', '/league/league-sync', '/login', '/'])(
      'redirects %s to the connect page',
      async (path) => {
        expect(redirectedTo(await proxy(request(path)))).toBe('/auth/connect-sleeper');
      },
    );
  });

  describe('authenticated', () => {
    beforeEach(() => {
      authMock.mockResolvedValue({
        user: { id: 'u1', pendingOAuth: false, sleeperUserId: '732081797726334976' },
      });
    });

    it.each(['/', '/login'])('sends %s straight to the dashboard', async (path) => {
      expect(redirectedTo(await proxy(request(path)))).toBe('/league/dashboard');
    });

    it.each(['/league/dashboard', '/league/league-sync', '/league/stats-sync', '/league/members'])(
      'allows %s',
      async (path) => {
        expect(redirectedTo(await proxy(request(path)))).toBeNull();
      },
    );
  });
});
