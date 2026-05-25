import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection proxy.
 *
 * States a request can be in:
 *   1. Unauthenticated              → only / is allowed; everything else → /
 *   2. pendingOAuth === true        → OAuth done but not yet in DB; must
 *                                     complete Sleeper verification at
 *                                     /auth/connect-sleeper before going anywhere else
 *   3. Fully authenticated          → normal access; skip the login page
 */

// Paths a pendingOAuth user is allowed to visit
const PENDING_ALLOWED = new Set(['/auth/connect-sleeper', '/auth/redirect']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session      = await auth();

  const isLoggedIn   = !!session?.user;
  const isPending    = session?.user?.pendingOAuth === true;

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    if (pathname === '/') return NextResponse.next();
    return NextResponse.redirect(new URL('/', request.url));
  }

  // ── Pending OAuth — gate until Sleeper is verified ─────────────────────────
  if (isPending) {
    if (PENDING_ALLOWED.has(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL('/auth/connect-sleeper', request.url));
  }

  // ── Fully authenticated ────────────────────────────────────────────────────
  // Skip the login page
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/league/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
