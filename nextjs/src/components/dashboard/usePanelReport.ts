// src/components/dashboard/usePanelReport.ts
//
// The one request a league panel is built around, made without being asked.
//
// Matchup, Waivers and Trades each opened empty behind a button. That was the
// right trade when all three shared the League tab — three unrequested Sleeper
// builds is not a page load — but each has its own tab now, so opening the tab
// is the request. The button stays as a refresh: scores and odds move during a
// game, and a panel has to be able to catch up without a page reload.
//
// Both paths run the same fetch. Cheaply, too: these routes hold their
// assembled response for a minute (ROUTE_CACHE_TTL.LIVE), so flicking between
// tabs re-renders from the cache rather than rebuilding anything.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelReport<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Runs the same fetch again — what the panel's button drives. */
  reload: () => Promise<void>;
}

/**
 * Loads `endpoint?leagueId=…&userId=…` on mount, and again whenever the league
 * or the user changes under the panel.
 *
 * @param endpoint      Route path, without the query string.
 * @param leagueId      Selected league, or null while none is.
 * @param userId        Signed-in Sleeper user, or null.
 * @param errorMessage  Shown when the response carries no message of its own.
 */
export function usePanelReport<T>(
  endpoint: string,
  leagueId: string | null,
  userId: string | null,
  errorMessage: string,
): PanelReport<T> {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Which request the panel is waiting for. Every run claims the next number,
  // and only the holder of the current one may paint — switching leagues
  // mid-flight must not leave the old league's answer on the new league's
  // panel, whichever of the two lands second.
  const requestId = useRef(0);

  const run = useCallback(async () => {
    if (!leagueId || !userId) return;

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const res  = await fetch(`${endpoint}?leagueId=${leagueId}&userId=${userId}`);
      // Tolerated rather than trusted: a route that fell over answers in HTML,
      // and the reader should see what went wrong rather than a parser's
      // complaint about it.
      const json = await res.json().catch(() => null) as (T & { error?: string }) | null;

      if (id !== requestId.current) return;
      if (!res.ok || !json) throw new Error(json?.error ?? errorMessage);
      setData(json);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [endpoint, leagueId, userId, errorMessage]);

  // Mounting is the reader opening the tab, so this is the whole of the
  // auto-load. `run` changes identity with the league and the user, which is
  // what re-runs it when the selector at the top of the page moves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void run(); }, [run]);

  return { data, loading, error, reload: run };
}
