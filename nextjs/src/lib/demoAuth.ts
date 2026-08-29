// src/lib/demoAuth.ts
//
// Password-free sign-in for DEMO_MODE.
//
// ── What this is for ─────────────────────────────────────────────────────────
// DEMO_MODE=true already swaps the Sleeper endpoints for mock rosters. Without
// this, the demo still stops at a login wall, which makes it useless for a
// walkthrough — and makes local UI work require hand-minting a session token.
//
// ── What it costs ────────────────────────────────────────────────────────────
// While DEMO_MODE=true, ANYONE who can reach the app is signed in as
// DEMO_LOGIN_USERNAME with that account's real role. The default account is the
// admin, which is a COMMISSIONER, so the demo visitor can trigger syncs and
// change roles. Never set DEMO_MODE=true on a deployment holding real data.
//
// Point DEMO_LOGIN_USERNAME at a MEMBER account to hand out a read-only demo.
//
// Kept out of src/auth.ts so it can be unit-tested without importing NextAuth,
// which is ESM-only and cannot be transformed by ts-jest — the same reason
// authHelpers.ts exists.

import { prisma } from '@/lib/prisma';

/** True when the password-free demo provider should be registered at all. */
export const IS_DEMO_LOGIN = process.env.DEMO_MODE === 'true';

/** The account a demo sign-in lands on. */
export function demoUsername(): string {
  return process.env.DEMO_LOGIN_USERNAME ?? process.env.ADMIN_USERNAME ?? 'admin';
}

/**
 * Resolves the demo account to a real DB user.
 *
 * Returns null — a failed sign-in — when the account does not exist, rather
 * than inventing a user. A synthetic id would satisfy the session but 404 in
 * every route that looks the session user up by id.
 */
export async function authorizeDemo(): Promise<{
  id: string;
  name: string | null;
  email: string | null;
} | null> {
  if (!IS_DEMO_LOGIN) return null;

  const user = await prisma.user.findUnique({
    where: { username: demoUsername() },
    select: { id: true, name: true, email: true },
  });
  if (!user) return null;

  return { id: user.id, name: user.name, email: user.email };
}
