// tests/hooks/useAgentUsage.test.ts
//
// The hour's allowance, across a page reload.
//
// The bug this covers: the meter lived in state that started at zero on every
// mount, so fourteen prompts and a refresh showed 0/15 — right up until the
// server refused the fifteenth. What is pinned here is that a reload shows the
// count that is actually in force, that the browser's memory survives a server
// whose in-process bucket does not, and that the window reopening re-enables
// the composer without a reload.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useAgentUsage } from '@/components/ai/useAgentUsage';

type FetchArgs = Parameters<typeof fetch>;

const HOUR = 60 * 60 * 1000;

/** Installs a fetch that answers GET ?usage=1 with `body`. */
function serverReports(body: unknown, ok = true) {
  globalThis.fetch = jest.fn((...args: FetchArgs) =>
    Promise.resolve({ ok, json: () => Promise.resolve(body), url: String(args[0]) } as Response),
  ) as unknown as typeof fetch;
}

/** Installs a fetch that never answers — the route being down. */
function serverUnreachable() {
  globalThis.fetch = jest.fn((...args: FetchArgs) =>
    Promise.reject(new Error(`offline: ${String(args[0])}`)),
  ) as unknown as typeof fetch;
}

function headers(values: Record<string, string>): Headers {
  return { get: (name: string) => values[name] ?? null } as Headers;
}

beforeEach(() => {
  localStorage.clear();
  // crypto.randomUUID is absent from jsdom's crypto in some versions; the hook
  // only needs it to mint a client ID once.
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...globalThis.crypto, randomUUID: () => 'test-client-id' },
      configurable: true,
    });
  }
  serverReports({
    limit: 15, used: 0, remaining: 15, resetAt: Date.now() + HOUR,
    dailyLimit: 250, dailyUsed: 0, dailyResetAt: Date.now() + 6 * HOUR,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAgentUsage', () => {
  // WHY: This is the whole point. The count the page opens with has to be the
  //      count the next prompt will be measured against.
  it('opens with the count the server is already holding', async () => {
    const resetAt = Date.now() + 40 * 60 * 1000;
    serverReports({ limit: 15, used: 11, remaining: 4, resetAt, dailyUsed: 30 });

    const { result } = renderHook(() => useAgentUsage());

    await waitFor(() => expect(result.current.usage.used).toBe(11));
    expect(result.current.usage.remaining).toBe(4);
    expect(result.current.usage.dailyUsed).toBe(30);
    expect(result.current.exhausted).toBe(false);
  });

  // WHY: The route counts against a stable per-browser ID. Without it every
  //      reload would be a new client to a server behind a shared IP.
  it('sends a stable client id and reuses it across mounts', async () => {
    const first = renderHook(() => useAgentUsage());
    await waitFor(() => expect(first.result.current.clientId).not.toBe(''));
    const id = first.result.current.clientId;

    const second = renderHook(() => useAgentUsage());
    await waitFor(() => expect(second.result.current.clientId).toBe(id));
  });

  // WHY: The server's buckets are in-process. A cold start or a second instance
  //      reports a window this reader never had, and believing it hands them an
  //      allowance the next 429 will take straight back.
  it('keeps the browser\'s higher count when the server reports a fresh window', async () => {
    const first = renderHook(() => useAgentUsage());
    await waitFor(() => expect(first.result.current.usage.limit).toBe(15));

    act(() => {
      first.result.current.recordResponse(headers({
        'X-RateLimit-Limit': '15',
        'X-RateLimit-Remaining': '3',
        'X-RateLimit-Reset': String(Date.now() + 30 * 60 * 1000),
        'X-Daily-Prompts-Used': '40',
      }));
    });
    expect(first.result.current.usage.used).toBe(12);

    // The server restarts and reports an empty bucket.
    serverReports({ limit: 15, used: 0, remaining: 15, resetAt: Date.now() + HOUR, dailyUsed: 0 });
    const second = renderHook(() => useAgentUsage());

    await waitFor(() => expect(second.result.current.usage.used).toBe(12));
    expect(second.result.current.usage.remaining).toBe(3);
  });

  // WHY: The server is authoritative when it knows more than the browser does —
  //      a second device on the same account, say.
  it('takes the server\'s higher count over the browser\'s', async () => {
    const first = renderHook(() => useAgentUsage());
    await waitFor(() => expect(first.result.current.usage.limit).toBe(15));
    act(() => {
      first.result.current.recordResponse(headers({
        'X-RateLimit-Limit': '15',
        'X-RateLimit-Remaining': '13',
        'X-RateLimit-Reset': String(Date.now() + 50 * 60 * 1000),
        'X-Daily-Prompts-Used': '2',
      }));
    });

    serverReports({ limit: 15, used: 9, remaining: 6, resetAt: Date.now() + 20 * 60 * 1000, dailyUsed: 9 });
    const second = renderHook(() => useAgentUsage());

    await waitFor(() => expect(second.result.current.usage.used).toBe(9));
  });

  // WHY: Offline is not a reset. The stored count is all there is, and it is
  //      still better than pretending the hour is untouched.
  it('falls back to the stored count when the usage call fails', async () => {
    const first = renderHook(() => useAgentUsage());
    await waitFor(() => expect(first.result.current.usage.limit).toBe(15));
    act(() => {
      first.result.current.recordResponse(headers({
        'X-RateLimit-Limit': '15',
        'X-RateLimit-Remaining': '5',
        'X-RateLimit-Reset': String(Date.now() + 45 * 60 * 1000),
        'X-Daily-Prompts-Used': '10',
      }));
    });

    serverUnreachable();
    const second = renderHook(() => useAgentUsage());

    await waitFor(() => expect(second.result.current.usage.used).toBe(10));
  });

  // WHY: A window that rolled over says nothing about this one. Carrying the
  //      old count forward would lock a reader out of an hour they never used.
  it('ignores a stored count whose window has already reset', async () => {
    localStorage.setItem('agent_usage', JSON.stringify({
      used: 15, resetAt: Date.now() - 1000, dailyUsed: 15, limit: 15,
    }));

    const { result } = renderHook(() => useAgentUsage());

    await waitFor(() => expect(result.current.usage.used).toBe(0));
    expect(result.current.exhausted).toBe(false);
  });

  // WHY: A 429 is the one answer that carries no usage headers. Without this
  //      the meter would sit at 14/15 while every further prompt bounced.
  it('marks the window spent on a rejection', async () => {
    const { result } = renderHook(() => useAgentUsage());
    await waitFor(() => expect(result.current.usage.limit).toBe(15));

    const resetAt = Date.now() + 15 * 60 * 1000;
    act(() => { result.current.recordRejection(resetAt); });

    expect(result.current.usage.used).toBe(15);
    expect(result.current.usage.remaining).toBe(0);
    expect(result.current.usage.resetAt).toBe(resetAt);
    expect(result.current.exhausted).toBe(true);
  });

  // WHY: Without this the composer stays disabled after a 429 until the reader
  //      reloads the page, which is the opposite of a limit that resets itself.
  it('re-opens the allowance when the window rolls over', async () => {
    const { result } = renderHook(() => useAgentUsage());
    await waitFor(() => expect(result.current.usage.limit).toBe(15));

    jest.useFakeTimers();
    act(() => { result.current.recordRejection(Date.now() + 60_000); });
    expect(result.current.exhausted).toBe(true);

    await act(async () => { jest.advanceTimersByTime(62_000); });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.usage.used).toBe(0);
  });
  // WHY: The shared daily budget closes the composer for everyone, and it is a
  //      different sentence from "you have used your fifteen" — a reader who has
  //      sent two prompts should not be told they are out of their own.
  it('reports the day as spent, separately from the reader\'s own hour', async () => {
    serverReports({
      limit: 15, used: 2, remaining: 13, resetAt: Date.now() + HOUR,
      dailyLimit: 250, dailyUsed: 250, dailyResetAt: Date.now() + 3 * HOUR,
    });

    const { result } = renderHook(() => useAgentUsage());

    await waitFor(() => expect(result.current.dayExhausted).toBe(true));
    // Their own hour is barely touched; the app's day is gone.
    expect(result.current.usage.used).toBe(2);
    expect(result.current.usage.remaining).toBe(13);
    expect(result.current.exhausted).toBe(true);
  });

  // WHY: The daily 429 carries no usage headers, and recording it as an hourly
  //      one would blank a reader's own allowance that they never spent.
  it('records a daily rejection against the day, not the hour', async () => {
    const { result } = renderHook(() => useAgentUsage());
    await waitFor(() => expect(result.current.usage.dailyLimit).toBe(250));

    const resetAt = Date.now() + 4 * HOUR;
    act(() => { result.current.recordRejection(resetAt, 'daily'); });

    expect(result.current.dayExhausted).toBe(true);
    expect(result.current.usage.dailyResetAt).toBe(resetAt);
    expect(result.current.usage.used).toBe(0);
    expect(result.current.usage.remaining).toBe(15);
  });

  // WHY: The two budgets run on different clocks — the reader's hour from their
  //      first prompt, the app's day to UTC midnight. An hourly reset that also
  //      zeroed the daily count would promise budget the app does not have.
  it('keeps the day\'s count across an hourly reset', async () => {
    serverReports({
      limit: 15, used: 0, remaining: 15, resetAt: Date.now() + HOUR,
      dailyLimit: 250, dailyUsed: 100, dailyResetAt: Date.now() + 5 * HOUR,
    });
    const { result } = renderHook(() => useAgentUsage());
    await waitFor(() => expect(result.current.usage.dailyUsed).toBe(100));

    jest.useFakeTimers();
    act(() => { result.current.recordRejection(Date.now() + 60_000); });
    await act(async () => { jest.advanceTimersByTime(62_000); });

    expect(result.current.usage.used).toBe(0);
    expect(result.current.usage.dailyUsed).toBe(100);
  });
});