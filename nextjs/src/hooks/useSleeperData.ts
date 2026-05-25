'use client';

import { useState, useEffect } from 'react';
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

export function useSleeperData() {
  const { data: session } = useSession();
  const [sleeperUser, setSleeperUser] = useState<SleeperUser | null>(null);
  const [activeLeagueId, setActiveLeagueIdInner] = useState<string | null>(null);

  useEffect(() => {
    const userId   = session?.user?.sleeperUserId;
    const username = session?.user?.username;
    if (!userId && !username) return;

    const param = userId
      ? `userId=${encodeURIComponent(userId)}`
      : `username=${encodeURIComponent(username!)}`;

    void fetch(`/api/sleeper/user?${param}`)
      .then((r) => (r.ok ? (r.json() as Promise<SleeperUser>) : null))
      .then((data) => {
        if (!data) return;
        setSleeperUser(data);
        const saved  = localStorage.getItem(LS_KEY);
        const match  = saved ? data.leagues.find((l) => l.leagueId === saved) : null;
        const league = match ?? data.leagues[0] ?? null;
        if (league) setActiveLeagueIdInner(league.leagueId);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.sleeperUserId, session?.user?.username]);

  function setActiveLeagueId(id: string) {
    setActiveLeagueIdInner(id);
    localStorage.setItem(LS_KEY, id);
  }

  return { sleeperUser, activeLeagueId, setActiveLeagueId };
}
