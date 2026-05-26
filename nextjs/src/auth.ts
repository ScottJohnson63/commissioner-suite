// src/auth.ts
//
// NextAuth v5 configuration for Commissioner Suite.
//
// ── Providers ────────────────────────────────────────────────────────────────
//   Discord   — primary OAuth provider for league members.
//   Google    — alternative OAuth provider.
//   Credentials — username + password login for the commissioner account
//                 created during initial setup.
//
// ── Authentication flow for OAuth users ──────────────────────────────────────
//   New OAuth users are NOT immediately written to the database on sign-in.
//   Instead, their JWT is flagged with `pendingOAuth: true` and they are
//   redirected to /auth/connect-sleeper where they must prove they belong to
//   one of the registered Sleeper leagues. Only after Sleeper verification does
//   the POST /api/auth/connect-sleeper route create the User + Account records.
//
//   This two-step flow prevents random Discord/Google accounts from gaining
//   access — only users who can prove Sleeper league membership are admitted.
//
// ── Authentication flow for credentials users ─────────────────────────────────
//   The credentials provider verifies the password hash with bcrypt and then
//   calls validateSleeperMembership to confirm the user's Sleeper account is
//   still active in a registered league. This re-check on every login ensures
//   that users who leave the league lose access automatically.
//
// ── JWT strategy ─────────────────────────────────────────────────────────────
//   Sessions use JWT (not a DB-backed session table). The jwt() callback is
//   the single source of truth: it loads the DB user on sign-in and on every
//   session update trigger (e.g. after Sleeper verification or role change).
//   The session() callback then maps token fields onto session.user.
//
// ── Required env vars ────────────────────────────────────────────────────────
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
//   GOOGLE_CLIENT_ID  / GOOGLE_CLIENT_SECRET   (optional if not used)
//   AUTH_SECRET                                 (NextAuth signing secret)
//   NFL_SEASON                                  (current NFL season year)

import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { SLEEPER_BASE } from '@/lib/sleeper/client';

// ─── Session type augmentation ────────────────────────────────────────────────

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
      username: string | null;
      sleeperUserId?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /**
       * true  → OAuth completed but user is NOT yet in the database.
       *         They must pass Sleeper verification before a DB record is created.
       * false → fully authenticated, DB record exists.
       */
      pendingOAuth: boolean;
      /** Only populated when pendingOAuth === true */
      pendingProvider?: string;
      pendingProviderAccountId?: string;
    };
  }
}

// ─── Sleeper helpers ──────────────────────────────────────────────────────────

const CURRENT_SEASON = parseInt(process.env.NFL_SEASON ?? String(new Date().getFullYear()), 10);

interface SleeperUserRaw {
  user_id: string;
  username: string;
}

interface SleeperLeagueRaw {
  league_id: string;
}

/**
 * Verifies that `sleeperUsername` is a member of at least one of the leagues
 * registered in the local database.
 *
 * Validation steps:
 *   1. Resolve the username to a Sleeper user object (gets the stable user_id).
 *   2. Fetch all leagues the user is a member of for the current NFL season.
 *   3. Cross-reference with leagues stored in the DB — at least one must match.
 *
 * @param sleeperUsername  Sleeper login handle (case-insensitive).
 * @returns  `{ userId, username }` if valid, or `null` if the user cannot be
 *           found on Sleeper, has no leagues, or is not in any registered league.
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

// ─── Auth config ──────────────────────────────────────────────────────────────

export const { handlers, signIn, signOut, auth } = NextAuth({
  /**
   * No adapter — users are NOT written to the database on OAuth sign-in.
   * The jwt callback detects whether the incoming OAuth account already exists.
   *   • Existing account  → load DB user into token, proceed normally.
   *   • New account       → mark token as "pending", gate access until the
   *                         user verifies their Sleeper username at
   *                         /auth/connect-sleeper.  The API route there creates
   *                         the User + Account records, then the client calls
   *                         update({ userId }) to resolve the pending state.
   */
  // Required when deployed behind a proxy/load balancer (e.g. AWS Lambda + API Gateway).
  // Without this, Auth.js ignores x-forwarded-proto and misidentifies the protocol,
  // causing PKCE cookie prefix mismatches that break OAuth callbacks.
  trustHost: true,
  providers: [
    Discord({
      clientId:    process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    Google({
      clientId:    process.env.GOOGLE_CLIENT_ID    ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
    Credentials({
      credentials: {
        username: { label: 'Username' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!username || !password) return null;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        // Validate Sleeper league membership using the stored user ID (or
        // username as a fallback if no Sleeper ID has been recorded yet).
        const sleeperLookup = user.sleeperUserId ?? user.username;
        if (!sleeperLookup) return null;

        const sleeper = await validateSleeperMembership(sleeperLookup);
        if (!sleeper) return null;

        // Keep the stored Sleeper user ID up to date.
        if (user.sleeperUserId !== sleeper.userId) {
          await prisma.user.update({
            where: { id: user.id },
            data:  { sleeperUserId: sleeper.userId },
          });
        }

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],

  session: { strategy: 'jwt' },

  callbacks: {
    // ─────────────────────────────────────────────────────────────────────────
    // jwt — the single source of truth for everything in the token.
    //
    // Strategy: always set the standard JWT profile fields (name / email /
    // picture) so NextAuth automatically populates session.user from them.
    // Our custom fields (id, role, username, pendingOAuth …) sit alongside.
    // ─────────────────────────────────────────────────────────────────────────
    async jwt({ token, user, account, trigger, session: sessionData }) {

      // ── A. OAuth sign-in ────────────────────────────────────────────────────
      if (account && account.provider !== 'credentials') {
        // Does this OAuth account already have a DB record?
        const existing = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider:          account.provider,
              providerAccountId: account.providerAccountId!,
            },
          },
          include: { user: true },
        });

        if (existing) {
          // ── Returning OAuth user — populate from DB ──────────────────────
          token.id           = existing.user.id;
          token.role         = existing.user.role;
          token.username     = existing.user.username;
          token.sleeperUserId = existing.user.sleeperUserId ?? null;
          token.pendingOAuth = false;
          // Keep standard JWT profile fields current with DB values
          token.name    = existing.user.name  ?? null;
          token.email   = existing.user.email ?? null;
          token.picture = existing.user.image ?? null;
        } else {
          // ── New OAuth user — hold in pending state ───────────────────────
          // Store enough to create User + Account after Sleeper verification.
          // Sensitive tokens (access_token, id_token) are intentionally omitted.
          token.id                      = null;
          token.pendingOAuth            = true;
          token.pendingProvider         = account.provider;
          token.pendingProviderAccountId = account.providerAccountId ?? null;
          token.pendingTokenType        = account.token_type ?? null;
          token.pendingScope            = account.scope      ?? null;
          token.pendingExpiresAt        = account.expires_at ?? null;
          // Populate standard profile fields — NextAuth will carry these into
          // session.user.name / email / image automatically.
          token.name    = user?.name  ?? null;
          token.email   = user?.email ?? null;
          token.picture = user?.image ?? null;
        }
        return token;
      }

      // ── B. Credentials sign-in ──────────────────────────────────────────────
      if (account?.provider === 'credentials' && user?.id) {
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!dbUser) return token;

        token.id           = dbUser.id;
        token.role         = dbUser.role;
        token.username     = dbUser.username;
        token.sleeperUserId = dbUser.sleeperUserId ?? null;
        token.pendingOAuth = false;
        token.name    = dbUser.name  ?? null;
        token.email   = dbUser.email ?? null;
        token.picture = dbUser.image ?? null;
        return token;
      }

      // ── C. Session update (after Sleeper verification or role change) ────────
      if (trigger === 'update') {
        // The connect-sleeper API passes { userId } after creating the DB record.
        const payload  = sessionData as { userId?: string } | null;
        const lookupId = payload?.userId ?? (token.id as string | null);
        if (!lookupId) return token;

        const dbUser = await prisma.user.findUnique({ where: { id: lookupId } });
        if (!dbUser) return token;

        token.id           = dbUser.id;
        token.role         = dbUser.role;
        token.username     = dbUser.username;
        token.sleeperUserId = dbUser.sleeperUserId ?? null;
        token.pendingOAuth = false;
        token.name    = dbUser.name  ?? null;
        token.email   = dbUser.email ?? null;
        token.picture = dbUser.image ?? null;

        // Clear pending fields
        token.pendingProvider          = undefined;
        token.pendingProviderAccountId = undefined;
        token.pendingTokenType         = undefined;
        token.pendingScope             = undefined;
        token.pendingExpiresAt         = undefined;

        return token;
      }

      return token;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // session — maps token fields onto session.user.
    //
    // NextAuth has already copied token.name / token.email / token.picture into
    // session.user before this callback runs, so we only need to set our custom
    // fields here.
    // ─────────────────────────────────────────────────────────────────────────
    session({ session, token }) {
      const isPending = (token.pendingOAuth as boolean) === true;

      session.user.pendingOAuth = isPending;

      if (isPending) {
        session.user.id                      = '';
        session.user.role                    = 'MEMBER';
        session.user.username                = null;
        session.user.pendingProvider         = token.pendingProvider         as string | undefined;
        session.user.pendingProviderAccountId = token.pendingProviderAccountId as string | undefined;
      } else {
        session.user.id          = (token.id          as string | null) ?? '';
        session.user.role        = (token.role        as string)        ?? 'MEMBER';
        session.user.username    = (token.username    as string | null) ?? null;
        session.user.sleeperUserId = (token.sleeperUserId as string | null | undefined) ?? null;
      }

      return session;
    },
  },

  pages: {
    signIn: '/',
  },
});
