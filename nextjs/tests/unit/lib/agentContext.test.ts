// tests/unit/lib/agentContext.test.ts
//
// Sleeper fetch behaviour for the AI agent's context layer.
//
// Every one of these calls sits on the request path of an AI answer, so the
// contract under test is narrow but important: a call must not be able to hang,
// and a failed call must degrade to empty/cached data rather than propagating.
//
// Each test re-imports the module so the in-process Sleeper cache starts empty.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperCache: {
      findUnique: jest.fn(),
      upsert:     jest.fn(),
    },
  },
}));

// The player map comes from the app-wide Sleeper cache, which owns the daily
// rate limit on /players/nfl. This module must go through it, never around it.
const mockGetPlayerMapSafe = jest.fn<() => Promise<Map<string, { name: string }>>>();
jest.mock('@/lib/sleeper/playerCache', () => ({
  getPlayerMapSafe: mockGetPlayerMapSafe,
}));

type AgentContext = typeof import('@/lib/agentContext');

async function freshModule(): Promise<AgentContext> {
  let mod!: AgentContext;
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/lib/agentContext');
  });
  return mod;
}

const mockFetch = jest.fn<typeof fetch>();

describe('agentContext — Sleeper fetches', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetPlayerMapSafe.mockReset();
    mockGetPlayerMapSafe.mockResolvedValue(new Map());
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  // WHY: An un-aborted fetch keeps the serverless function alive until the
  //      platform kills it, and the browser gets a 504 it cannot explain.
  //      Every Sleeper request must carry an abort signal.
  it('sends every request with an abort signal', async () => {
    mockFetch.mockResolvedValue(new Response('[]', { status: 200 }));

    const { fetchTrending } = await freshModule();
    await fetchTrending();

    expect(mockFetch).toHaveBeenCalled();
    for (const [, init] of mockFetch.mock.calls as [string, RequestInit][]) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  // WHY: A timed-out or refused Sleeper call must cost the answer some context,
  //      never the whole answer — the agent route awaits this inline.
  it('returns empty trending data when the request aborts', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));

    const { fetchTrending } = await freshModule();
    await expect(fetchTrending()).resolves.toEqual({ adds: [], drops: [] });
  });

  // WHY: Same contract for a non-OK upstream response, which is not an
  //      exception and so takes a different branch.
  it('returns empty trending data on an upstream error status', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 503 }));

    const { fetchTrending } = await freshModule();
    await expect(fetchTrending()).resolves.toEqual({ adds: [], drops: [] });
  });

  // WHY: Sleeper asks callers to hit /players/nfl at most once a day, and this
  //      module used to keep its own copy under a different cache key — a second
  //      daily download of the same ~10 MB payload. It must delegate to the
  //      shared cache and never reach for the endpoint itself.
  it('takes the player map from the shared cache without touching Sleeper', async () => {
    mockGetPlayerMapSafe.mockResolvedValue(new Map([
      ['4046', { name: 'Tom Brady' }],
      ['7564', { name: 'Justin Jefferson' }],
    ]));

    const { fetchSleeperPlayerMap } = await freshModule();
    await expect(fetchSleeperPlayerMap()).resolves.toEqual({
      '4046': 'Tom Brady',
      '7564': 'Justin Jefferson',
    });

    expect(mockGetPlayerMapSafe).toHaveBeenCalledTimes(1);
    const urls = (mockFetch.mock.calls as [string][]).map(([url]) => url);
    expect(urls.filter((u) => /\/players\/nfl$/.test(u))).toHaveLength(0);
  });

  // WHY: The map is cosmetic — it labels trending rows. Losing it must cost the
  //      labels, never the answer.
  it('returns an empty player map when the shared cache has nothing', async () => {
    mockGetPlayerMapSafe.mockResolvedValue(new Map());

    const { fetchSleeperPlayerMap } = await freshModule();
    await expect(fetchSleeperPlayerMap()).resolves.toEqual({});
  });
});
