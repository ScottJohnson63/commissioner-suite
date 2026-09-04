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

  // WHY: The player list is ~10 MB and is fetched inline whenever the cache is
  //      stale, so it is the most likely call to stall. A failure there must
  //      still yield a usable (empty) map.
  it('returns an empty player map rather than throwing when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('socket hang up'));

    const { fetchSleeperPlayerMap } = await freshModule();
    await expect(fetchSleeperPlayerMap()).resolves.toEqual({});
  });
});
