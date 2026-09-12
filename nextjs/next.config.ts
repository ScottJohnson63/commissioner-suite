import type { NextConfig } from "next";

import pkg from "./package.json";

const nextConfig: NextConfig = {
  typedRoutes: true,
  /**
   * Keep dead Prisma runtime blobs out of every Vercel Function.
   *
   * Vercel packages each route as its own Function, and each one bundles
   * whatever the file tracer reaches. `@prisma/client` ships a WASM build of
   * both the query engine and the query compiler for *every* database it
   * supports, in both .js and .mjs base64 form. The tracer sees the dynamic
   * requires in the package's edge/wasm entrypoints and pulls all of them in —
   * about 52MB per function, none of which this app can execute:
   *
   *   - query_engine_bg.*   — the Rust engine's WASM build. `engineType =
   *                           "client"` (prisma/schema.prisma) means the
   *                           generated client loads runtime/client.js, which
   *                           never references these at all.
   *   - query_compiler_bg.* — needed, but only the `sqlite` one. The datasource
   *                           provider is sqlite (Turso/libSQL), so the
   *                           cockroachdb/mysql/postgresql/sqlserver builds can
   *                           never be selected.
   *
   * The sqlite query compiler and the generated client are deliberately absent
   * from this list — those are the ones actually loaded at runtime.
   */
  outputFileTracingExcludes: {
    '**/*': [
      'node_modules/@prisma/client/runtime/query_engine_bg.*',
      'node_modules/@prisma/client/runtime/query_compiler_bg.cockroachdb.*',
      'node_modules/@prisma/client/runtime/query_compiler_bg.mysql.*',
      'node_modules/@prisma/client/runtime/query_compiler_bg.postgresql.*',
      'node_modules/@prisma/client/runtime/query_compiler_bg.sqlserver.*',
    ],
  },
  /**
   * League Sync and Stats Sync were pages of their own before they became tabs
   * of /league/commissioner. Nothing in the app links to them any more —
   * typedRoutes would fail the build if anything did — so this is purely for
   * bookmarks and anything a commissioner pasted into the league chat.
   *
   * Permanent, because the pages are not coming back. The tabs are React state
   * rather than routes of their own, so both land on the page's first tab; the
   * bar is right there, which beats a 404.
   */
  async redirects() {
    return [
      { source: '/league/league-sync', destination: '/league/commissioner', permanent: true },
      { source: '/league/stats-sync',  destination: '/league/commissioner', permanent: true },
    ];
  },
  // The About dialog reports the running version. Reading it from package.json
  // here keeps the number in one place; NEXT_PUBLIC_ is what makes it readable
  // from the client component that renders the dialog.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  images: {
    remotePatterns: [
      new URL('https://sleepercdn.com/**'),
      new URL('https://a.espncdn.com/**'),
      new URL('https://a1.espncdn.com/**'),
      new URL('https://s.yimg.com/**'),
      new URL('https://*.cbssports.com/**'),
      new URL('https://*.nbcsports.com/**'),
      new URL('https://static.www.nfl.com/**'),
      // Wikimedia Commons — the only portrait source that reaches pre-2009
      // players. See python/scripts/sync_player_headshots.py.
      new URL('https://upload.wikimedia.org/**'),
    ],
  },
};

export default nextConfig;
