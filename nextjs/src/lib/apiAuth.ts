// src/lib/apiAuth.ts — Role guards for API route handlers.
//
// Kept out of src/lib/api.ts so that the response-shape helpers stay importable
// from anywhere without dragging the auth stack (and its Prisma adapter) along
// with them.
//
// Each guard returns a NextResponse to send, or null to continue:
//
//   const denied = await requireCommissioner();
//   if (denied) return denied;
//
// Written as "return the rejection" rather than "throw" so the call sites read
// the same way as the rest of the handlers in this codebase, which return `err()`
// directly rather than relying on a catch.

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { err } from '@/lib/api';

/**
 * Rejects anyone who is not a commissioner.
 *
 * @returns A 403 response to return from the handler, or null when the caller
 *          is a commissioner and the handler should proceed.
 */
export async function requireCommissioner(): Promise<NextResponse | null> {
  const session = await auth();
  return session?.user?.role === 'COMMISSIONER' ? null : err('Forbidden', 403);
}

/**
 * Rejects anyone who is not signed in, whatever their role.
 *
 * @returns A 401 response to return from the handler, or null when a session
 *          exists and the handler should proceed.
 */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  return session ? null : err('Unauthorized', 401);
}

/**
 * Rejects anyone not signed in, and hands back who they are.
 *
 * The two guards above answer "may this request proceed?", which is all most
 * routes need. Routes that write something owned by a person — the card game's
 * collections and pack grants — also need the id to write it against, and
 * calling `auth()` a second time to get it both costs a round trip and invites
 * the two calls to disagree.
 *
 * Discriminated on `denied` so a caller narrows with one check:
 *
 * ```ts
 * const guard = await requireUser();
 * if (guard.denied) return guard.denied;
 * // guard.userId is a string from here on
 * ```
 */
export async function requireUser(): Promise<
  { denied: NextResponse; userId?: undefined; role?: undefined }
  | { denied: null; userId: string; role: string }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { denied: err('Unauthorized', 401) };
  return { denied: null, userId, role: session.user.role };
}

/**
 * Rejects anyone below MEMBER: signed-out callers and PLAYERs.
 *
 * PLAYER is the base role — the card game and the public dashboard tabs, and
 * nothing else (see the role table in src/app/api/users/[id]/route.ts). The
 * commissioner page's reads sit above that line: a PLAYER has no Schedules,
 * Lottery or Divisions tab to call them from, so a request for one is either a
 * stale client or somebody poking at the URL.
 *
 * 403 rather than 401 for a signed-out caller, matching requireCommissioner:
 * "you are not allowed here" is the same answer whether the reason is no
 * session or the wrong role, and the two guards reading alike is worth more
 * than the distinction.
 *
 * @returns A 403 response to return from the handler, or null when the caller
 *          is a member or a commissioner and the handler should proceed.
 */
export async function requireMember(): Promise<NextResponse | null> {
  const role = (await auth())?.user?.role;
  return role === 'MEMBER' || role === 'COMMISSIONER' ? null : err('Forbidden', 403);
}
