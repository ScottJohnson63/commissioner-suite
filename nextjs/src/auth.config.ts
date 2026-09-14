// src/auth.config.ts
//
// The half of the NextAuth configuration that never touches the database.
//
// Why this file exists: src/proxy.ts runs in front of every page request, and it
// only ever needs to *read* a JWT session. When it imported `auth` from
// @/auth it pulled in that module's providers and, through them, @/lib/prisma —
// so the middleware bundle carried the whole Prisma client and the libSQL driver
// it can never legitimately use. Next traces the middleware separately from the
// route handlers, so next.config.ts's outputFileTracingExcludes does not reach
// it: the bundle stayed at ~61MB against ~5MB for a typical route (#50).
//
// Splitting it this way is the shape Auth.js documents for edge-safe middleware.
// Reading a JWT needs no providers at all, which is why `providers` is empty
// here; @/auth spreads this config and supplies the real ones.
//
// Anything added below must stay free of database access. The jwt() callback is
// the DB-touching one and deliberately lives in @/auth, where the middleware
// cannot reach it — it only runs on sign-in and session update, never on the
// plain session reads the middleware performs.

import type { NextAuthConfig } from 'next-auth';

// ─── Session type augmentation ────────────────────────────────────────────────
//
// Declared here rather than in @/auth so that both @/auth and the middleware
// pick it up; the middleware no longer imports @/auth.

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
      pendingTokenType?: string | null;
      pendingScope?: string | null;
      pendingExpiresAt?: number | null;
    };
  }
}

export const authConfig = {
  // Required when deployed behind a proxy/load balancer (e.g. AWS Lambda + API Gateway).
  // Without this, Auth.js ignores x-forwarded-proto and misidentifies the protocol,
  // causing PKCE cookie prefix mismatches that break OAuth callbacks.
  trustHost: true,

  // Supplied by @/auth. The middleware only reads sessions, which needs none.
  providers: [],

  session: { strategy: 'jwt' },

  callbacks: {
    // ─────────────────────────────────────────────────────────────────────────
    // session — maps token fields onto session.user.
    //
    // NextAuth has already copied token.name / token.email / token.picture into
    // session.user before this callback runs, so we only need to set our custom
    // fields here.
    //
    // Pure: it reads the decoded token and nothing else. That is what lets the
    // middleware share it.
    // ─────────────────────────────────────────────────────────────────────────
    session({ session, token }) {
      const isPending = (token.pendingOAuth as boolean) === true;

      session.user.pendingOAuth = isPending;

      if (isPending) {
        session.user.id                      = '';
        session.user.role                    = 'MEMBER';
        session.user.username                = null;
        session.user.pendingProvider          = token.pendingProvider          as string | undefined;
        session.user.pendingProviderAccountId = token.pendingProviderAccountId as string | undefined;
        session.user.pendingTokenType         = (token.pendingTokenType  as string | null | undefined) ?? null;
        session.user.pendingScope             = (token.pendingScope      as string | null | undefined) ?? null;
        session.user.pendingExpiresAt         = (token.pendingExpiresAt  as number | null | undefined) ?? null;
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
    signIn: '/login',
  },
} satisfies NextAuthConfig;
