// tests/unit/lib/nflStats.test.ts
//
// The stat catalog is interpolated into raw SQL by /api/nfl/leaders, so a key
// that is not a real column is both a broken dropdown entry and the only place
// user-influenced text reaches a query. These tests pin it to the schema.
//
// This is the same class of drift that broke the nflverse sync in production:
// the Python writer and the table disagreed about which columns existed.

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { STAT_CATEGORIES, STAT_GROUPS, ALLOWED_STAT_COLS } from '@/lib/nflStats';

const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
const model = /model NflWeeklyStat \{([\s\S]*?)\n\}/.exec(schema)![1];

/** Every field on NflWeeklyStat, as name → Prisma type. */
const fields = new Map<string, string>(
  [...model.matchAll(/^ {2}(\w+)\s+(\S+)/gm)].map((m) => [m[1], m[2]]),
);

describe('stat catalog', () => {
  it('every key is a real column on NflWeeklyStat', () => {
    const unknown = STAT_CATEGORIES.map((c) => c.key).filter((k) => !fields.has(k));
    expect(unknown).toEqual([]);
  });

  // WHY: SUM() over a text column silently returns 0, so a mis-typed entry
  //      would produce a leaderboard of zeroes rather than an error.
  it('every key is numeric, never a text or identity column', () => {
    const nonNumeric = STAT_CATEGORIES
      .map((c) => c.key)
      .filter((k) => !/^(Int|Float)/.test(fields.get(k) ?? ''));
    expect(nonNumeric).toEqual([]);
  });

  // WHY: season and week identify a row; ranking players by them is meaningless.
  it('excludes the key columns', () => {
    for (const key of ['season', 'week', 'playerId']) {
      expect(ALLOWED_STAT_COLS.has(key)).toBe(false);
    }
  });

  // WHY: The allowlist is the guard on $queryRawUnsafe. If it ever stopped
  //      matching the catalog, a dropdown entry would 400 — or worse, a column
  //      could be allowed that the UI never vetted.
  it('the SQL allowlist is exactly the catalog', () => {
    expect([...ALLOWED_STAT_COLS].sort()).toEqual(
      STAT_CATEGORIES.map((c) => c.key).sort(),
    );
  });

  it('has no duplicate keys', () => {
    const keys = STAT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every stat a label and a group the dropdown can render', () => {
    for (const c of STAT_CATEGORIES) {
      expect(c.label.trim()).not.toBe('');
      expect(STAT_GROUPS).toContain(c.group);
      expect(c.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  // WHY: The whole point of widening the table was full nflverse coverage;
  //      a regression here would quietly shrink the menu back down.
  it('covers the full stat set, not just the original handful', () => {
    expect(STAT_CATEGORIES.length).toBeGreaterThan(120);
    for (const group of ['Kicking', 'Punting', 'Returns', 'Defense']) {
      expect(STAT_GROUPS).toContain(group);
    }
  });

  it('keeps the hand-written labels for the original stats', () => {
    const byKey = new Map(STAT_CATEGORIES.map((c) => [c.key, c.label]));
    expect(byKey.get('fantasyPointsPpr')).toBe('Fantasy Points (PPR)');
    expect(byKey.get('passingYardsAfterCatch')).toBe('YAC');
    expect(byKey.get('defInterceptions')).toBe('INTs');
  });
});
