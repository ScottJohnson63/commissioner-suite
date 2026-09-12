// tests/helpers/session.ts
//
// Session fixtures for route tests.
//
// A route test's subject is what the handler does once the caller is past the
// guard, so most tests want "somebody appropriate is signed in" in one line
// rather than a hand-rolled session object per file. The guards themselves are
// tested against these same fixtures — see tests/unit/lib/apiAuth.test.ts for
// the guards in isolation, and the auth describe in each route test for the
// wiring.
//
// Cast at the call site with `as never`, matching the existing route tests:
// the real Session type carries NextAuth's full shape, and widening these to
// satisfy it would add nothing a guard reads.

type Role = 'COMMISSIONER' | 'MEMBER' | 'PLAYER';

function sessionAs(role: Role) {
  return {
    user: {
      id:            'u1',
      role,
      username:      'tester',
      sleeperUserId: 's1',
      pendingOAuth:  false,
    },
    expires: '2999-01-01T00:00:00.000Z',
  };
}

/** Passes every guard. */
export const COMMISSIONER = sessionAs('COMMISSIONER');

/** Passes requireSession, requireUser and requireMember; fails requireCommissioner. */
export const MEMBER = sessionAs('MEMBER');

/** The base role: passes requireSession and requireUser, fails requireMember. */
export const PLAYER = sessionAs('PLAYER');

/** No session at all — what auth() resolves to for a signed-out caller. */
export const SIGNED_OUT = null;
