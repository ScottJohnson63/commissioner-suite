import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection proxy.
 *
 * States a request can be in:
 *   1. Unauthenticated              → PUBLIC_PATHS only; everything else → /
 *   2. pendingOAuth === true        → OAuth done but not yet in DB; must
 *                                     complete Sleeper verification at
 *                                     /auth/connect-sleeper before going anywhere else
 *   3. Fully authenticated          → normal access; skip the login page
 *
 * NOTE: `config.matcher` below excludes /api, so this proxy has never guarded
 * the API routes — each one authenticates itself or does not. Adding a page to
 * PUBLIC_PATHS therefore changes what is *reachable in the UI*, not what data
 * is exposed.
 */

// Paths a pendingOAuth user is allowed to visit
const PENDING_ALLOWED = new Set(['/auth/connect-sleeper', '/auth/redirect']);

/**
 * Reachable without signing in.
 *
 * The dashboard is public so the Statistics and News tabs can be browsed by
 * anyone; the page itself hides every other tab until there is a session. The
 * data behind those two tabs (/api/nfl/*, /api/news, /api/trending) is
 * unauthenticated already.
 *
 * `/` is here only because it redirects to the dashboard — the app opens there
 * rather than on a login wall. The sign-in form is at /login.
 */
const PUBLIC_PATHS = new Set(['/', '/login', '/league/dashboard']);

/** Where a signed-out visitor is sent when they ask for a gated page. */
const LOGIN_PATH = '/login';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session      = await auth();

  const isLoggedIn   = !!session?.user;
  const isPending    = session?.user?.pendingOAuth === true;

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  // ── Pending OAuth — gate until Sleeper is verified ─────────────────────────
  if (isPending) {
    if (PENDING_ALLOWED.has(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL('/auth/connect-sleeper', request.url));
  }

  // ── Signed in but not linked to Sleeper ────────────────────────────────────
  // Same destination as the pending-OAuth gate, for a user whose sleeperUserId
  // was cleared (or never set). Sign-out stays reachable throughout: it is a
  // POST to /api/auth/signout, which `config.matcher` excludes.
  if (!session?.user?.sleeperUserId) {
    if (PENDING_ALLOWED.has(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL('/auth/connect-sleeper', request.url));
  }

  // ── Fully authenticated ────────────────────────────────────────────────────
  // Skip the login page. `/` redirects to the dashboard on its own, but doing
  // it here too saves the extra hop.
  if (pathname === '/' || pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL('/league/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
