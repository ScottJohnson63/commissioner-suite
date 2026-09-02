// tests/unit/lib/sleeper/week.test.ts
//
// Covers src/lib/sleeper/week.ts — resolving which NFL season and week a request
// is about.
//
// Three routes share this logic. On the week they want one of two answers —
// matchup-report the week now in progress, waiver-suggestions the last completed
// one — and on the season they all want NFL_SEASON, because that is what the
// stat sync writes rows under. Both fall back to something renderable when
// Sleeper is unreachable rather than failing the request.

import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/sleeper/client', () => ({
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

import { resolveSeason, resolveWeek } from '@/lib/sleeper/week';
import { sleeperGet } from '@/lib/sleeper/client';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

describe('resolveWeek()', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockSleeperGet.mockResolvedValue({ week: 8, season: '2026' } as never);
  });

  // WHY: an explicit ?week= is a deliberate choice by the caller — honouring it
  //      without asking Sleeper also saves a network round trip per request.
  it('takes an explicit week at face value and does not call Sleeper', async () => {
    expect(await resolveWeek('5', 'current')).toBe(5);
    expect(await resolveWeek(5, 'completed')).toBe(5);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  it("returns the in-progress week for mode 'current'", async () => {
    expect(await resolveWeek(null, 'current')).toBe(8);
  });

  // WHY: the current week has no final results yet, so waiver and scoring views
  //      ask for the one before it.
  it("returns the previous week for mode 'completed'", async () => {
    expect(await resolveWeek(null, 'completed')).toBe(7);
  });

  it("never returns week 0 in 'completed' mode during week 1", async () => {
    mockSleeperGet.mockResolvedValue({ week: 1, season: '2026' } as never);
    expect(await resolveWeek(null, 'completed')).toBe(1);
  });

  // WHY: Sleeper being down should degrade to a readable page, not a 500.
  it('falls back to week 1 when Sleeper throws', async () => {
    mockSleeperGet.mockRejectedValue(new Error('Sleeper 503'));
    expect(await resolveWeek(null, 'current')).toBe(1);
    expect(await resolveWeek(null, 'completed')).toBe(1);
  });

  // WHY: query params arrive as strings and may be empty or junk; treating those
  //      as "not supplied" is what the original inline code did via `? :`.
  it('treats empty, zero, and non-numeric input as absent', async () => {
    expect(await resolveWeek('', 'current')).toBe(8);
    expect(await resolveWeek('0', 'current')).toBe(8);
    expect(await resolveWeek('abc', 'current')).toBe(8);
    expect(await resolveWeek(undefined, 'current')).toBe(8);
  });

  it("defaults to 'current' when no mode is given", async () => {
    expect(await resolveWeek(null)).toBe(8);
  });
});

describe('resolveSeason()', () => {
  const original = process.env.NFL_SEASON;

  beforeEach(() => {
    mockSleeperGet.mockReset();
    mockSleeperGet.mockResolvedValue({ week: 8, season: '2026' } as never);
    process.env.NFL_SEASON = '2026';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NFL_SEASON;
    else process.env.NFL_SEASON = original;
  });

  it('takes an explicit season at face value and does not call Sleeper', async () => {
    expect(await resolveSeason('2024')).toBe(2024);
    expect(await resolveSeason(2024)).toBe(2024);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: NFL_SEASON is the season the stat sync writes rows under. Reading a
  //      season the sync is not writing is the exact failure this ordering
  //      exists to prevent, so it outranks Sleeper's own answer.
  it('prefers NFL_SEASON over Sleeper and does not call it', async () => {
    process.env.NFL_SEASON = '2025';
    expect(await resolveSeason(null)).toBe(2025);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  it('asks Sleeper when NFL_SEASON is unset', async () => {
    delete process.env.NFL_SEASON;
    expect(await resolveSeason(null)).toBe(2026);
  });

  // WHY: same rule as resolveWeek — a bad env value or a Sleeper outage should
  //      leave the page renderable rather than 500 it.
  it('falls back to the calendar year when both are unusable', async () => {
    process.env.NFL_SEASON = 'not-a-year';
    mockSleeperGet.mockRejectedValue(new Error('Sleeper 503'));
    expect(await resolveSeason(null)).toBe(new Date().getFullYear());
  });

  it('treats empty, zero and non-numeric input as absent', async () => {
    expect(await resolveSeason('')).toBe(2026);
    expect(await resolveSeason('0')).toBe(2026);
    expect(await resolveSeason('abc')).toBe(2026);
    expect(await resolveSeason(undefined)).toBe(2026);
  });
});
