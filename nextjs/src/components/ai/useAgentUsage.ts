'use client';

// src/components/ai/useAgentUsage.ts
//
// The hour's prompt allowance, as the reader sees it.
//
// The meter used to live in three `useState`s that started at zero on every
// mount, so a reload drew a full allowance over a window that was already
// spent: send fourteen prompts, refresh, and the page said 0/15 right up until
// the server answered the fifteenth with a 429 out of nowhere.
//
// Two sources, because neither alone is enough:
//
//   The server owns the limit. `GET /api/agent?usage=1` reads the bucket
//   without spending from it, which is the count the next POST will actually be
//   measured against.
//
//   The browser owns the memory. The server's buckets are in-process, so a
//   cold start or a second instance reports a window this reader never had —
//   see src/lib/rateLimit.ts. The last known count is kept in localStorage
//   against its own reset time, and the higher of the two is shown.
//
// Higher, deliberately: over-reporting costs a prompt the reader could have
// sent, and under-reporting promises prompts that will be refused.

import { useState, useEffect, useCallback, useRef } from 'react';

const LS_KEY = 'agent_usage';
const LS_CLIENT_KEY = 'agent_client_id';

export interface AgentUsage {
  limit:     number;
  used:      number;
  remaining: number;
  /** Unix ms at which the window rolls over. */
  resetAt:   number;
  /** The app-wide daily budget, shared by everyone. */
  dailyLimit:   number;
  dailyUsed:    number;
  dailyResetAt: number;
}

/** What the page needs before the first response tells it anything. */
const DEFAULT_LIMIT = 15;
const DEFAULT_DAILY_LIMIT = 250;

/** Unix ms of the next UTC midnight, matching the server's daily rollover. */
function nextUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

interface StoredUsage { used: number; resetAt: number; dailyUsed: number; limit: number; }

function readStored(): StoredUsage | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUsage>;
    if (typeof parsed.used !== 'number' || typeof parsed.resetAt !== 'number') return null;
    // A window that has already rolled over says nothing about this one.
    if (parsed.resetAt <= Date.now()) return null;
    return {
      used:      parsed.used,
      resetAt:   parsed.resetAt,
      dailyUsed: typeof parsed.dailyUsed === 'number' ? parsed.dailyUsed : 0,
      limit:     typeof parsed.limit === 'number' ? parsed.limit : DEFAULT_LIMIT,
    };
  } catch {
    // Private mode, cleared storage, a value from an older shape — all mean
    // "no memory", which the server's count covers.
    return null;
  }
}

function writeStored(u: AgentUsage): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      used: u.used, resetAt: u.resetAt, dailyUsed: u.dailyUsed, limit: u.limit,
    }));
  } catch { /* storage unavailable — the server still holds the real count. */ }
}

/** The stable per-browser ID the route counts against. */
function readClientId(): string {
  try {
    let id = localStorage.getItem(LS_CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(LS_CLIENT_KEY, id);
    }
    return id;
  } catch {
    // Without storage the ID cannot persist; the route falls back to the
    // forwarded IP, which is the next best stable key.
    return '';
  }
}

/**
 * A fresh hour, with the day's figures carried through.
 *
 * The two budgets roll over on different clocks: the hourly window is this
 * reader's own and resets an hour after their first prompt, while the daily one
 * is shared by everyone and resets at UTC midnight. An hourly reset that also
 * zeroed the daily count would tell the reader the app had budget it does not.
 */
const zero = (prev: AgentUsage): AgentUsage => ({
  ...prev,
  used: 0,
  remaining: prev.limit,
  resetAt: Date.now() + 60 * 60 * 1000,
});

export interface UsageController {
  usage: AgentUsage;
  /** True once either budget is spent — the composer is closed for both. */
  exhausted: boolean;
  /** True when it is the app-wide day that is gone, not this reader's hour. */
  dayExhausted: boolean;
  /** The header this page must send so the count follows the browser, not the IP. */
  clientId: string;
  /** Applies the usage headers on a successful answer. */
  recordResponse: (headers: Headers) => void;
  /** Applies a 429 — the named budget is spent until `resetAt`. */
  recordRejection: (resetAt?: number, scope?: 'hourly' | 'daily') => void;
}

export function useAgentUsage(): UsageController {
  const [usage, setUsage] = useState<AgentUsage>(() => ({
    limit: DEFAULT_LIMIT, used: 0, remaining: DEFAULT_LIMIT,
    resetAt: Date.now() + 60 * 60 * 1000,
    dailyLimit: DEFAULT_DAILY_LIMIT, dailyUsed: 0, dailyResetAt: nextUtcMidnight(),
  }));
  const [clientId, setClientId] = useState('');
  // The window this reader is in. Held in a ref as well so the reset timer
  // below does not have to re-run every time the count changes.
  const resetAtRef = useRef(usage.resetAt);

  const apply = useCallback((next: AgentUsage) => {
    resetAtRef.current = next.resetAt;
    setUsage(next);
    writeStored(next);
  }, []);

  // ── First paint: the browser's memory, then the server's count ─────────────
  useEffect(() => {
    const id = readClientId();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientId(id);

    const stored = readStored();
    if (stored) {
      setUsage((u) => ({
        ...u,
        limit:     stored.limit,
        used:      Math.min(stored.used, stored.limit),
        remaining: Math.max(0, stored.limit - stored.used),
        resetAt:   stored.resetAt,
        dailyUsed: stored.dailyUsed,
      }));
      resetAtRef.current = stored.resetAt;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/agent?usage=1', {
          cache: 'no-store',
          headers: id ? { 'X-Client-Id': id } : undefined,
        });
        if (!res.ok || cancelled) return;
        const server = (await res.json()) as AgentUsage;
        if (cancelled) return;

        // The higher count wins, and it carries its own window with it: a
        // reader whose browser remembers twelve prompts is not handed a fresh
        // fifteen because the server restarted.
        const mine = readStored();
        const useStored = mine !== null && mine.used > server.used;
        // The day's figures always come from the server: it is the only party
        // that can see what everyone else has spent.
        apply(useStored
          ? {
              ...server,
              used:      Math.min(mine.used, server.limit),
              remaining: Math.max(0, server.limit - mine.used),
              resetAt:   mine.resetAt,
            }
          : server);
      } catch {
        // Offline or the route is down — the stored count above stands, and the
        // next POST will correct it.
      }
    })();

    return () => { cancelled = true; };
  }, [apply]);

  // ── The window rolling over ───────────────────────────────────────────────
  // Without this the composer stays disabled after a 429 until the reader
  // reloads, which is the opposite of the point.
  useEffect(() => {
    const due = resetAtRef.current - Date.now();
    if (due <= 0) return undefined;
    const t = setTimeout(() => {
      setUsage((u) => {
        const fresh = zero(u);
        resetAtRef.current = fresh.resetAt;
        writeStored(fresh);
        return fresh;
      });
    }, due + 1000);
    return () => clearTimeout(t);
  }, [usage.resetAt]);

  const recordResponse = useCallback((headers: Headers) => {
    const limit      = Number(headers.get('X-RateLimit-Limit') ?? DEFAULT_LIMIT);
    const remaining  = Number(headers.get('X-RateLimit-Remaining') ?? 0);
    const resetAt    = Number(headers.get('X-RateLimit-Reset') ?? 0);
    const dailyLimit = Number(headers.get('X-Daily-Limit') ?? DEFAULT_DAILY_LIMIT);
    const dailyReset = Number(headers.get('X-Daily-Reset') ?? 0);
    apply({
      limit,
      used:      Math.max(0, limit - remaining),
      remaining: Math.max(0, remaining),
      resetAt:   resetAt > 0 ? resetAt : resetAtRef.current,
      dailyLimit,
      dailyUsed:    Number(headers.get('X-Daily-Prompts-Used') ?? 0),
      dailyResetAt: dailyReset > 0 ? dailyReset : nextUtcMidnight(),
    });
  }, [apply]);

  /**
   * A 429, from either budget.
   *
   * The daily one is not this reader's to spend down, so it is recorded as the
   * app being out rather than as their own hour being gone — the composer says
   * a different thing in each case, and "you have used your 15" is the wrong
   * one when they have used two.
   */
  const recordRejection = useCallback((resetAt?: number, scope: 'hourly' | 'daily' = 'hourly') => {
    setUsage((u) => {
      const next: AgentUsage = scope === 'daily'
        ? {
            ...u,
            dailyUsed:    Math.max(u.dailyUsed, u.dailyLimit),
            dailyResetAt: resetAt && resetAt > Date.now() ? resetAt : u.dailyResetAt,
          }
        : {
            ...u,
            used:      u.limit,
            remaining: 0,
            resetAt:   resetAt && resetAt > Date.now() ? resetAt : u.resetAt,
          };
      if (scope !== 'daily') resetAtRef.current = next.resetAt;
      writeStored(next);
      return next;
    });
  }, []);

  const dayExhausted = usage.dailyUsed >= usage.dailyLimit;

  return {
    usage,
    exhausted: usage.remaining <= 0 || dayExhausted,
    dayExhausted,
    clientId,
    recordResponse,
    recordRejection,
  };
}
