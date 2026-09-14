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
import { validateSleeperMembership, resolveSleeperUser, authorizeCredentials } from '@/lib/authHelpers';
import { authConfig } from '@/auth.config';

// Re-export the pure helpers so callers who previously imported from @/auth
// (e.g. the connect-sleeper API route) continue to work without changes.
export { validateSleeperMembership, resolveSleeperUser, authorizeCredentials };

// The Session type augmentation lives in @/auth.config so the middleware, which
// no longer imports this module, still picks it up.

// ─── Auth config ──────────────────────────────────────────────────────────────
//
// This is the full configuration: everything in @/auth.config plus the parts
// that reach the database. src/proxy.ts deliberately uses @/auth.config alone —
// see the comment there for why.

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
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
  // trustHost, session strategy and pages come from @/auth.config.
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
      authorize: authorizeCredentials,
    }),
  ],

  callbacks: {
    // session() comes from @/auth.config — it is pure, so the middleware shares it.
    ...authConfig.callbacks,

    // ─────────────────────────────────────────────────────────────────────────
    // jwt — the single source of truth for everything in the token.
    //
    // Strategy: always set the standard JWT profile fields (name / email /
    // picture) so NextAuth automatically populates session.user from them.
    // Our custom fields (id, role, username, pendingOAuth …) sit alongside.
    // ─────────────────────────────────────────────────────────────────────────
    async jwt({ token, user, account, trigger, session: sessionData }) {

      // Password login is a Credentials provider: it resolves a DB user itself
      // and has no linked Account row, so it may not take the OAuth path below.
      const isLocalProvider = account?.provider === 'credentials';

      // ── A. OAuth sign-in ────────────────────────────────────────────────────
      if (account && !isLocalProvider) {
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
      if (isLocalProvider && user?.id) {
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

  },
});
