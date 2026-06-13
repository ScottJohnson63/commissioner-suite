// src/lib/authHelpers.ts
//
// Pure auth-logic functions extracted from src/auth.ts so they can be unit-
// tested without importing the NextAuth package (which is ESM-only and cannot
// be transformed by ts-jest in the Node test environment).
//
// auth.ts re-exports both functions from here and passes authorizeCredentials
// directly to the Credentials provider.

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { SLEEPER_BASE } from '@/lib/sleeper/client';

const CURRENT_SEASON = parseInt(process.env.NFL_SEASON || String(new Date().getFullYear()), 10);

interface SleeperUserRaw {
  user_id:  string;
  username: string;
}

interface SleeperLeagueRaw {
  league_id: string;
}

/**
 * Verifies that `sleeperUsername` is a member of at least one league
 * registered in the local database.
 *
 * Resolution order:
 *   1. Resolve username → Sleeper user object (stable user_id).
 *   2. Fetch all leagues the user belongs to for the current NFL season.
 *   3. Cross-reference with leagues stored in the DB.
 *
 * Returns `null` (never throws) if the user is not found, has no leagues,
 * or is not in any registered league — a broken Sleeper API must not crash
 * the login page.
 */
export async function validateSleeperMembership(
  sleeperUsername: string,
): Promise<{ userId: string; username: string } | null> {
  try {
    const userRes = await fetch(
      `${SLEEPER_BASE}/user/${encodeURIComponent(sleeperUsername.trim().toLowerCase())}`,
    );
    if (!userRes.ok) return null;
    const user = (await userRes.json()) as SleeperUserRaw;
    if (!user?.user_id) return null;

    const leaguesRes = await fetch(
      `${SLEEPER_BASE}/user/${user.user_id}/leagues/nfl/${CURRENT_SEASON}`,
    );
    if (!leaguesRes.ok) return null;
    const leagues = (await leaguesRes.json()) as SleeperLeagueRaw[];

    const dbLeagues   = await prisma.league.findMany({ select: { sleeperLeagueId: true } });
    const dbLeagueIds = new Set(dbLeagues.map((l) => l.sleeperLeagueId));

    const inLeague = (leagues ?? []).some((l) => dbLeagueIds.has(l.league_id));
    if (!inLeague) return null;

    return { userId: user.user_id, username: user.username };
  } catch {
    return null;
  }
}

/**
 * Credentials-provider authorize function.
 *
 * Validates username+password against the DB, then re-confirms Sleeper league
 * membership so users who leave the league lose access on their next login.
 *
 * Returns the minimal user object that NextAuth stores in the JWT, or null to
 * reject the sign-in attempt.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<'username' | 'password', unknown>> | undefined,
): Promise<{ id: string; name: string | null; email: string | null; image: string | null } | null> {
  const username = credentials?.username as string | undefined;
  const password = credentials?.password as string | undefined;

  if (!username || !password) return null;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user?.password) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  // Prefer the stored Sleeper user ID (more stable than username).
  const sleeperLookup = user.sleeperUserId ?? user.username;
  if (!sleeperLookup) return null;

  const sleeper = await validateSleeperMembership(sleeperLookup);
  if (!sleeper) return null;

  // Keep the stored Sleeper user ID up to date if it changed.
  if (user.sleeperUserId !== sleeper.userId) {
    await prisma.user.update({
      where: { id: user.id },
      data:  { sleeperUserId: sleeper.userId },
    });
  }

  return { id: user.id, name: user.name, email: user.email, image: user.image };
}
