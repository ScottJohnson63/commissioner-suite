import type { NextConfig } from "next";

import pkg from "./package.json";

const nextConfig: NextConfig = {
  typedRoutes: true,
  /**
   * Keep dead Prisma runtime blobs out of every Vercel Function.
   *
   * Vercel packages each route as its own Function, and each one bundles
   * whatever the file tracer reaches. `@prisma/client` ships a runtime build for
   * every engine and every host it supports, in both .js and .mjs form, and the
   * tracer follows the dynamic requires in the package's entrypoints and pulls
   * all of them in — replicated across ~50 Functions.
   *
   * The list below is the complement of what actually loads. That was measured,
   * not guessed: constructing the real generated client and running a query,
   * then dumping require.cache and every readFileSync, reaches exactly
   *
   *   .prisma/client/{default,index,query_compiler_bg}.js
   *   .prisma/client/query_compiler_bg.wasm
   *   @prisma/client/default.js
   *   @prisma/client/runtime/client.js
   *
   * plus @prisma/debug, @prisma/driver-adapter-utils and the adapter. So:
   *
   *   - query_engine_bg.*    — the Rust engine's WASM build. `engineType =
   *                            "client"` (prisma/schema.prisma) means the
   *                            generated client never references these at all.
   *   - query_compiler_bg.*  — under @prisma/client/runtime these are the *edge*
   *                            base64 fallbacks, one per provider, and none is
   *                            loaded on the Node runtime. Note the live query
   *                            compiler is the copy the generator emits at
   *                            node_modules/.prisma/client/query_compiler_bg.
   *                            {js,wasm}, which this list does not touch.
   *   - binary.*, library.*  — the other two engine runtimes, both dead under
   *                            engineType = "client".
   *   - edge*, wasm-*-edge.* — the edge-runtime builds. No route opts into the
   *   - react-native.*         edge runtime, and nothing here is React Native.
   *   - client.mjs           — the server output is CJS, so only client.js runs.
   *   - *.d.ts, *.d.mts      — type declarations; never executed.
   *
   * @img/** and sharp/** are libvips for next/image. Vercel runs image
   * optimization on its own infrastructure rather than inside the Function, so
   * these are inert there — but they are the one entry here not proven by the
   * probe above. If remote images stop rendering in production, this pair is the
   * first thing to drop; it is only ~45MB of the ~1,490MB this block saves.
   *
   * Note this does NOT apply to the middleware bundle, which Next traces
   * separately — see src/auth.config.ts for how that one is kept small.
   */
  outputFileTracingExcludes: {
    '**/*': [
      'node_modules/@prisma/client/runtime/query_engine_bg.*',
      'node_modules/@prisma/client/runtime/query_compiler_bg.*',
      'node_modules/@prisma/client/runtime/binary.*',
      'node_modules/@prisma/client/runtime/library.*',
      'node_modules/@prisma/client/runtime/react-native.*',
      'node_modules/@prisma/client/runtime/edge.*',
      'node_modules/@prisma/client/runtime/edge-esm.*',
      'node_modules/@prisma/client/runtime/wasm-engine-edge.*',
      'node_modules/@prisma/client/runtime/wasm-compiler-edge.*',
      'node_modules/@prisma/client/runtime/client.mjs',
      'node_modules/@prisma/client/runtime/*.d.ts',
      'node_modules/@prisma/client/runtime/*.d.mts',
      'node_modules/.prisma/client/edge.js',
      'node_modules/.prisma/client/wasm.js',
      'node_modules/.prisma/client/*.d.ts',
      'node_modules/@img/**',
      'node_modules/sharp/**',
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
