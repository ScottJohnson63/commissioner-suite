'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

export interface SleeperLeague {
  leagueId: string;
  name: string;
  season: number;
  totalRosters: number;
  status: string;
}

export interface SleeperUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  leagues: SleeperLeague[];
}

const LS_KEY = 'sleeper_active_league';

/** A row from GET /api/leagues — the commissioner-curated allowlist. */
interface RegisteredLeague {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
}

export function useSleeperData() {
  const { data: session } = useSession();
  const [sleeperUser, setSleeperUser] = useState<SleeperUser | null>(null);
  const [activeLeagueId, setActiveLeagueIdInner] = useState<string | null>(null);
  // Bumped by refresh() to re-run the effect after the allowlist changes.
  const [reloadKey, setReloadKey] = useState(0);

  const role = session?.user?.role;

  useEffect(() => {
    const userId   = session?.user?.sleeperUserId;
    const username = session?.user?.username;
    if (!userId && !username) return;

    const param = userId
      ? `userId=${encodeURIComponent(userId)}`
      : `username=${encodeURIComponent(username!)}`;

    let cancelled = false;

    async function load() {
      // The League table is the allowlist. A member's Sleeper account may sit in
      // a dozen unrelated leagues; only the ones a commissioner registered are
      // this app's business, so the two lists are intersected here.
      //
      // no-store on the allowlist specifically: it changes the moment a
      // commissioner adds or removes a league, and a cached copy would leave a
      // deleted league sitting in the dropdown. The Sleeper call keeps its
      // normal caching — removing a league here does not change what Sleeper
      // reports about the user.
      const [userRes, leaguesRes] = await Promise.all([
        fetch(`/api/sleeper/user?${param}`),
        fetch('/api/leagues', { cache: 'no-store' }),
      ]);

      if (!userRes.ok) return;
      const data = (await userRes.json()) as SleeperUser;

      const registered: RegisteredLeague[] = leaguesRes.ok
        ? ((await leaguesRes.json()) as RegisteredLeague[])
        : [];
      const registeredIds = new Set(registered.map((l) => l.sleeperLeagueId));

      // A commissioner may run a league they do not play in, so they keep every
      // registered league. Anyone else sees only their own, and only if it is
      // registered.
      const visible =
        role === 'COMMISSIONER'
          ? [
              ...data.leagues.filter((l) => registeredIds.has(l.leagueId)),
              ...registered
                .filter((r) => !data.leagues.some((l) => l.leagueId === r.sleeperLeagueId))
                .map((r) => ({
                  leagueId: r.sleeperLeagueId,
                  name: r.name || r.sleeperLeagueId,
                  season: r.season,
                  totalRosters: 0,
                  status: 'unknown',
                })),
            ]
          : data.leagues.filter((l) => registeredIds.has(l.leagueId));

      if (cancelled) return;
      setSleeperUser({ ...data, leagues: visible });

      // The saved selection can name a league that has just been removed, so it
      // is only honoured if it is still visible. Falling through to the first
      // remaining league — or to null when none are left — keeps the dropdown
      // and every league-scoped sync pointed at something that exists.
      const saved  = localStorage.getItem(LS_KEY);
      const match  = saved ? visible.find((l) => l.leagueId === saved) : null;
      const league = match ?? visible[0] ?? null;

      setActiveLeagueIdInner(league?.leagueId ?? null);
      if (league) {
        localStorage.setItem(LS_KEY, league.leagueId);
      } else {
        // Nothing left to point at; drop the stale id rather than resurrecting
        // it on the next page load.
        localStorage.removeItem(LS_KEY);
      }
    }

    // A failure here leaves the selector empty; each page surfaces its own error.
    void load().catch(() => {});

    return () => { cancelled = true; };
  }, [session?.user?.sleeperUserId, session?.user?.username, role, reloadKey]);

  function setActiveLeagueId(id: string) {
    setActiveLeagueIdInner(id);
    localStorage.setItem(LS_KEY, id);
  }

  /** Re-reads the allowlist. Call after registering or removing a league. */
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { sleeperUser, activeLeagueId, setActiveLeagueId, refresh };
}
