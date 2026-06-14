// src/app/api/auth/connect-sleeper/route.ts
//
// POST /api/auth/connect-sleeper
//
// Handles Sleeper username verification for two distinct authentication paths:
//
// ── Path A: New OAuth user (pendingOAuth === true) ──────────────────────────
//   New users who sign in with Discord or Google are initially placed in a
//   "pending" state — their JWT is marked with `pendingOAuth: true` and no DB
//   record exists for them yet. They are redirected to /auth/connect-sleeper
//   where they must supply a Sleeper username.
//
//   This endpoint:
//     1. Validates that the Sleeper username belongs to a member of a
//        registered Sleeper league (via validateSleeperMembership).
//     2. If valid, creates the User and Account records in a DB transaction.
//     3. Returns { ok: true, userId } so the client can call
//        `update({ userId })` on the NextAuth session to resolve the pending
//        state and grant full access.
//
// ── Path B: Existing user reconnecting their Sleeper account ────────────────
//   Credentials-based users (e.g. the admin account) can connect or reconnect
//   a Sleeper username to their existing DB record. Commissioners skip the
//   Sleeper membership check — they are trusted by role.
//
// Required header: valid NextAuth JWT (checked via `getToken`)
// Required body:   { sleeperUsername: string }

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { validateSleeperMembership } from '@/auth';
import { ok, err } from '@/lib/api';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // secureCookie must match how NextAuth set the cookie:
  // production (HTTPS) → "__Secure-authjs.session-token"
  // development        → "authjs.session-token"
  const token = await getToken({ req, secureCookie: process.env.NODE_ENV === 'production' });

  if (!token) {
    return err('Unauthorized', 401);
  }

  const body             = (await req.json()) as { sleeperUsername?: string };
  const sleeperUsername  = body.sleeperUsername?.trim().toLowerCase();

  if (!sleeperUsername) {
    return err('sleeperUsername is required', 400);
  }

  const isPending = token.pendingOAuth === true;

  // ── Path A: New OAuth user — pending Sleeper verification ────────────────────
  if (isPending) {
    const provider          = token.pendingProvider          as string | undefined;
    const providerAccountId = token.pendingProviderAccountId as string | undefined;

    if (!provider || !providerAccountId) {
      return err('Missing OAuth provider data. Please sign in again.', 400);
    }

    // Validate Sleeper membership
    const sleeper = await validateSleeperMembership(sleeperUsername);
    if (!sleeper) {
      return err('Your Sleeper account is not a member of any registered league.', 403);
    }

    // Guard: don't create a duplicate account if something raced
    const existingAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    });
    if (existingAccount) {
      // Account was already created (unlikely race). Just return the userId so
      // the client can refresh its session.
      return ok({ ok: true, userId: existingAccount.userId });
    }

    // Create User then Account sequentially.
    // (Interactive transactions are not supported by the libsql driver adapter.)
    const newUser = await prisma.user.create({
      data: {
        name:          (token.name    as string | null) ?? null,
        email:         (token.email   as string | null) ?? null,
        image:         (token.picture as string | null) ?? null,
        username:      sleeper.username,
        sleeperUserId: sleeper.userId,
        role:          'MEMBER',
      },
    });

    await prisma.account.create({
      data: {
        userId:           newUser.id,
        type:             'oauth',
        provider,
        providerAccountId,
        token_type:       (token.pendingTokenType  as string | null) ?? null,
        scope:            (token.pendingScope       as string | null) ?? null,
        expires_at:       (token.pendingExpiresAt   as number | null) ?? null,
      },
    });

    return ok({ ok: true, userId: newUser.id });
  }

  // ── Path B: Existing credentials/admin user reconnecting their Sleeper ───────
  const userId = token.id as string | null;
  if (!userId) {
    return err('Unauthorized', 401);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!dbUser) {
    return err('User not found', 404);
  }

  // Commissioners (e.g. admin) skip Sleeper validation
  const isCommissioner = dbUser.role === 'COMMISSIONER';
  if (!isCommissioner) {
    const sleeper = await validateSleeperMembership(sleeperUsername);
    if (!sleeper) {
      return err('Your Sleeper account is not a member of any registered league.', 403);
    }
    await prisma.user.update({
      where: { id: userId },
      data: {
        sleeperUserId: sleeper.userId,
        ...(dbUser.username !== ADMIN_USERNAME && { username: sleeper.username }),
      },
    });
  }

  return ok({ ok: true, userId });
}
