// tests/components/formatKickoff.test.ts
//
// Covers the kickoff formatter in ContextTooltip.
//
// The subtlety is that the stored value is *already* Eastern — nflverse
// publishes NFL kickoffs in ET, which is why the slate lands on 13:00, 16:25 and
// 20:20, and why the London games read 09:30. So this labels and formats; it
// must never convert, and it must never go through `new Date(string)`, which
// would read the zone-less value as the viewer's own local time and shift it.

import { describe, it, expect } from '@jest/globals';
import { formatKickoff } from '@/components/dashboard/ContextTooltip';

describe('formatKickoff()', () => {
  it('renders the stored Eastern time, labelled', () => {
    expect(formatKickoff('2026-09-13T13:00')).toBe('Sun 13 Sep · 1:00 PM ET');
  });

  it('reads afternoon and evening slots correctly', () => {
    expect(formatKickoff('2026-09-13T16:25')).toBe('Sun 13 Sep · 4:25 PM ET');
    expect(formatKickoff('2026-09-09T20:20')).toBe('Wed 9 Sep · 8:20 PM ET');
  });

  // WHY: the London window. A morning kickoff is the case a 24-hour clock reads
  //      wrong most easily, and 12 has to become 12 rather than 0.
  it('handles morning kickoffs and both noon boundaries', () => {
    expect(formatKickoff('2026-10-04T09:30')).toBe('Sun 4 Oct · 9:30 AM ET');
    expect(formatKickoff('2026-10-04T12:00')).toBe('Sun 4 Oct · 12:00 PM ET');
    expect(formatKickoff('2026-10-04T00:15')).toBe('Sun 4 Oct · 12:15 AM ET');
  });

  // WHY: the whole reason this is hand-rolled rather than going through Date —
  //      that would show a 1pm ET kickoff as 10am to a reader in California.
  it('renders the same string whatever the viewer timezone', () => {
    const original = process.env.TZ;
    const rendered = new Set<string>();
    for (const tz of ['America/Los_Angeles', 'UTC', 'Australia/Melbourne', 'Europe/London']) {
      process.env.TZ = tz;
      rendered.add(formatKickoff('2026-09-13T13:00'));
    }
    process.env.TZ = original;
    expect([...rendered]).toEqual(['Sun 13 Sep · 1:00 PM ET']);
  });

  // WHY: a fixture recovered from the betting line carries no kickoff, and a
  //      malformed one should read as itself rather than as "Invalid Date".
  it('passes through anything it cannot parse', () => {
    expect(formatKickoff('sometime')).toBe('sometime');
    expect(formatKickoff('')).toBe('');
  });
});
