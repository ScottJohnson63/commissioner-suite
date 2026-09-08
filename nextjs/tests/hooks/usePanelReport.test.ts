// tests/hooks/usePanelReport.test.ts
//
// The dashboard's league panels no longer wait to be asked: opening the tab is
// the request. What is pinned here is the part of that which is easy to get
// wrong — that the fetch goes out on its own, that switching leagues goes out
// again, and that a slow answer to a league you have already left never gets
// painted over the one you are looking at.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react';

import { usePanelReport } from '@/components/dashboard/usePanelReport';

interface Report { season: number }

type FetchArgs = Parameters<typeof fetch>;

let calls: string[] = [];

/** Installs a fetch that answers every call with `body`, 200 OK. */
function respondWith(body: unknown, ok = true) {
  const impl = (url: FetchArgs[0]) => {
    calls.push(String(url));
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  };
  globalThis.fetch = jest.fn(impl) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

const ENDPOINT = '/api/sleeper/matchup-report';

describe('usePanelReport', () => {
  it('fetches on mount, with the league and user in the query', async () => {
    respondWith({ season: 2025 });

    const { result } = renderHook(() => usePanelReport<Report>(ENDPOINT, 'L1', 'U1', 'nope'));

    await waitFor(() => expect(result.current.data).toEqual({ season: 2025 }));
    expect(calls).toEqual([`${ENDPOINT}?leagueId=L1&userId=U1`]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch until there is both a league and a user', async () => {
    respondWith({ season: 2025 });

    const { rerender } = renderHook(
      ({ league }: { league: string | null }) =>
        usePanelReport<Report>(ENDPOINT, league, 'U1', 'nope'),
      { initialProps: { league: null as string | null } },
    );

    expect(calls).toEqual([]);

    rerender({ league: 'L1' });
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('fetches again when the league changes under it', async () => {
    respondWith({ season: 2025 });

    const { rerender } = renderHook(
      ({ league }: { league: string }) => usePanelReport<Report>(ENDPOINT, league, 'U1', 'nope'),
      { initialProps: { league: 'L1' } },
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ league: 'L2' });
    await waitFor(() => expect(calls).toEqual([
      `${ENDPOINT}?leagueId=L1&userId=U1`,
      `${ENDPOINT}?leagueId=L2&userId=U1`,
    ]));
  });

  it('drops a superseded answer rather than painting it over the current one', async () => {
    // The first league's request is left hanging until after the second has
    // answered — the order a league switch mid-request produces.
    let releaseFirst: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { releaseFirst = resolve; });

    globalThis.fetch = jest.fn((url: FetchArgs[0]) => {
      const slow = String(url).includes('L1');
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (slow) await pending;
          return { season: slow ? 1999 : 2025 };
        },
      } as Response);
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ league }: { league: string }) => usePanelReport<Report>(ENDPOINT, league, 'U1', 'nope'),
      { initialProps: { league: 'L1' } },
    );

    rerender({ league: 'L2' });
    await waitFor(() => expect(result.current.data).toEqual({ season: 2025 }));

    await act(async () => { releaseFirst?.(); await Promise.resolve(); });
    expect(result.current.data).toEqual({ season: 2025 });
  });

  it('reload runs the same request again', async () => {
    respondWith({ season: 2025 });

    const { result } = renderHook(() => usePanelReport<Report>(ENDPOINT, 'L1', 'U1', 'nope'));
    await waitFor(() => expect(calls).toHaveLength(1));

    await act(async () => { await result.current.reload(); });
    expect(calls).toEqual([
      `${ENDPOINT}?leagueId=L1&userId=U1`,
      `${ENDPOINT}?leagueId=L1&userId=U1`,
    ]);
  });

  it('prefers the error the route sent, and falls back to the panel’s own', async () => {
    respondWith({ error: 'No matchup this week' }, false);

    const { result } = renderHook(() => usePanelReport<Report>(ENDPOINT, 'L1', 'U1', 'Failed'));
    await waitFor(() => expect(result.current.error).toBe('No matchup this week'));
    expect(result.current.data).toBeNull();

    respondWith({}, false);
    const second = renderHook(() => usePanelReport<Report>(ENDPOINT, 'L1', 'U1', 'Failed'));
    await waitFor(() => expect(second.result.current.error).toBe('Failed'));
  });
});
