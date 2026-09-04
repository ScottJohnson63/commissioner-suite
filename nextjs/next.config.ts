import type { NextConfig } from "next";

import pkg from "./package.json";

const nextConfig: NextConfig = {
  typedRoutes: true,
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
