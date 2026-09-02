import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
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
