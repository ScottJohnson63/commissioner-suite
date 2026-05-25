import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  const isLoggedIn = !!session?.user;
  const isLoginPage = pathname === '/';
  const isProtected =
    pathname.startsWith('/league') ||
    pathname.startsWith('/assoc') ||
    pathname.startsWith('/assoc/dashboard');

  // Unauthenticated user hitting a protected route → login
  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Authenticated user hitting the login page → dashboard
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/league/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
