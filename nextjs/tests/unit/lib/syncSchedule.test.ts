// tests/unit/lib/syncSchedule.test.ts
//
// The cron evaluator here decides the "Next run" the dashboard shows. If it is
// wrong nothing crashes — the UI just quietly lies about when data arrives —
// so the real cron strings from .github/workflows are asserted directly.

import { describe, it, expect } from '@jest/globals';
import {
  SYNC_JOBS, nextRun, previousRun, nextActiveRun, nextSeasonStart, parseCron, isInSeason, jobFor,
} from '@/lib/syncSchedule';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('parseCron()', () => {
  it('rejects an expression that is not five fields', () => {
    expect(() => parseCron('0 8 * *')).toThrow(/5 cron fields/);
  });

  // WHY: Ranges and steps are valid cron but unimplemented here. Silently
  //      mis-parsing them would produce a plausible-looking wrong date.
  it('rejects syntax it cannot evaluate rather than guessing', () => {
    expect(() => parseCron('0 8 * * 1-5')).toThrow(/Unsupported/);
    expect(() => parseCron('*/15 8 * * *')).toThrow(/Unsupported/);
  });

  it('rejects out-of-range values', () => {
    expect(() => parseCron('0 25 * * *')).toThrow(/Unsupported/);
  });
});

describe('nextRun()', () => {
  // WHY: The weekly stats job. Wednesday should roll forward to next Tuesday.
  it('finds the next weekday occurrence', () => {
    // 2026-08-26 is a Wednesday.
    expect(nextRun('0 8 * * 2', utc('2026-08-26T09:00:00'))?.toISOString())
      .toBe('2026-09-01T08:00:00.000Z');
  });

  // WHY: Same day but before the fire time must return today, not next week.
  it('returns today when the fire time has not passed yet', () => {
    // 2026-09-01 is a Tuesday.
    expect(nextRun('0 8 * * 2', utc('2026-09-01T07:59:00'))?.toISOString())
      .toBe('2026-09-01T08:00:00.000Z');
  });

  // WHY: Exactly at the fire time the run is already happening, so the next one
  //      is a week out. Showing "now" forever would be worse than showing next.
  it('moves past a fire time that has just arrived', () => {
    expect(nextRun('0 8 * * 2', utc('2026-09-01T08:00:00'))?.toISOString())
      .toBe('2026-09-08T08:00:00.000Z');
  });

  // WHY: The season reset is annual; a day-by-day scan must survive the rollover.
  it('crosses a year boundary for an annual cron', () => {
    expect(nextRun('0 8 1 8 *', utc('2026-08-23T00:00:00'))?.toISOString())
      .toBe('2027-08-01T08:00:00.000Z');
  });

  it('handles a non-zero minute', () => {
    expect(nextRun('30 8 * * 2', utc('2026-09-01T08:15:00'))?.toISOString())
      .toBe('2026-09-01T08:30:00.000Z');
  });

  // WHY: Guards the two-year scan cap — an impossible date must return null
  //      rather than loop or return a garbage Date.
  it('returns null for an unsatisfiable expression', () => {
    expect(nextRun('0 8 30 2 *', utc('2026-01-01T00:00:00'))).toBeNull();
  });
});

describe('isInSeason()', () => {
  it.each(['2026-08-01', '2026-09-15', '2026-12-31', '2027-01-20', '2027-02-01'])(
    'treats %s as in season',
    (day) => expect(isInSeason(utc(`${day}T12:00:00`))).toBe(true),
  );

  it.each(['2026-02-02', '2026-03-15', '2026-06-01', '2026-07-31'])(
    'treats %s as offseason',
    (day) => expect(isInSeason(utc(`${day}T12:00:00`))).toBe(false),
  );
});

describe('SYNC_JOBS', () => {
  it('has a unique source per job', () => {
    const sources = SYNC_JOBS.map((j) => j.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  // WHY: A cron the parser cannot read would throw inside the status route and
  //      blank the whole tab.
  it('every cron is parseable and resolves to a future date', () => {
    for (const job of SYNC_JOBS) {
      if (!job.cron) continue;
      expect(nextRun(job.cron, utc('2026-08-23T00:00:00'))).toBeInstanceOf(Date);
    }
  });

  // WHY: dispatchWorkflow only sends a `force` input to jobs that declare one;
  //      the season reset deliberately opts out because it truncates tables.
  it('does not force the destructive season reset on a manual run', () => {
    expect(jobFor('NFL_SEASON_RESET')?.forceOnManualRun).toBe(false);
  });

  it('runs the league sync in-process rather than via a workflow', () => {
    expect(jobFor('SLEEPER_LEAGUES')?.workflow).toBeNull();
  });
});

describe('previousRun()', () => {
  // The Sleeper scores cron: Tuesdays at 08:30 UTC.
  const TUESDAY_0830 = '30 8 * * 2';

  it('returns the same day when the fire time has passed', () => {
    expect(previousRun(TUESDAY_0830, utc('2026-08-25T12:00:00')))
      .toEqual(utc('2026-08-25T08:30:00'));
  });

  // WHY: Before the fire time, "previously" is last week — reading it as today
  //      would make a job look overdue on the morning it is due.
  it('skips back a week when the fire time has not arrived yet', () => {
    expect(previousRun(TUESDAY_0830, utc('2026-08-25T08:00:00')))
      .toEqual(utc('2026-08-18T08:30:00'));
  });

  it('is strictly before `from`, never equal to it', () => {
    expect(previousRun(TUESDAY_0830, utc('2026-08-25T08:30:00')))
      .toEqual(utc('2026-08-18T08:30:00'));
  });

  it('walks back across a month boundary', () => {
    expect(previousRun(TUESDAY_0830, utc('2026-09-01T00:00:00')))
      .toEqual(utc('2026-08-25T08:30:00'));
  });

  // WHY: The annual jobs are the ones most likely to silently stop, so the
  //      backward scan has to cover a full year, not just a few weeks.
  it('finds the previous firing of a once-a-year cron', () => {
    // NFL Season Reset: August 1st at 08:00 UTC.
    expect(previousRun('0 8 1 8 *', utc('2026-08-27T00:00:00')))
      .toEqual(utc('2026-08-01T08:00:00'));
  });

  it('pairs with nextRun to bracket the current moment', () => {
    const now = utc('2026-08-27T15:00:00');
    for (const job of SYNC_JOBS) {
      if (!job.cron) continue;
      const prev = previousRun(job.cron, now);
      const next = nextRun(job.cron, now);
      expect(prev!.getTime()).toBeLessThan(now.getTime());
      expect(next!.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('coming back for the new season', () => {
  const TUESDAY_0830 = '30 8 * * 2';

  it('finds the next August 1 from mid-offseason', () => {
    expect(nextSeasonStart(utc('2026-03-15T00:00:00'))).toEqual(utc('2026-08-01T00:00:00'));
  });

  it('rolls to next year once August has started', () => {
    expect(nextSeasonStart(utc('2026-09-10T00:00:00'))).toEqual(utc('2027-08-01T00:00:00'));
  });

  // WHY: This is the answer to "will it start up again in August?". Every cron
  //      firing between March and August only writes a SKIPPED row, so the
  //      literal next run is true and useless.
  it('skips past the whole offseason to the first firing that does work', () => {
    const resumes = nextActiveRun(TUESDAY_0830, true, utc('2026-03-15T00:00:00'));
    expect(resumes).toEqual(utc('2026-08-04T08:30:00'));
    expect(isInSeason(resumes!)).toBe(true);
  });

  it('leaves an in-season feed on its real next run', () => {
    const from = utc('2026-09-10T00:00:00');
    expect(nextActiveRun(TUESDAY_0830, true, from)).toEqual(nextRun(TUESDAY_0830, from));
  });

  // WHY: The season reset is not seasonal — it *is* the season boundary, and
  //      pushing it past August 1 would move it a year out.
  it('leaves a non-seasonal feed alone', () => {
    const from = utc('2026-03-15T00:00:00');
    expect(nextActiveRun('0 8 1 8 *', false, from)).toEqual(utc('2026-08-01T08:00:00'));
  });

  it('every seasonal job resumes inside the season, from any point in the year', () => {
    for (const month of ['01', '03', '06', '07', '09', '12']) {
      for (const job of SYNC_JOBS) {
        if (!job.cron || !job.seasonal) continue;
        const resumes = nextActiveRun(job.cron, true, utc(`2026-${month}-10T00:00:00`));
        expect(isInSeason(resumes!)).toBe(true);
      }
    }
  });
});

// The offseason guard exists twice — here and in python/scripts/common/season.py,
// which is what actually stops the jobs. If they drift, the UI promises a resume
// date the scripts do not honour.
describe('season window agrees with the Python guard', () => {
  const seasonPy = readFileSync(
    resolve(__dirname, '../../../../python/scripts/common/season.py'),
    'utf8',
  );

  const constant = (name: string): number => {
    const match = seasonPy.match(new RegExp(`^${name} = (\\d+)$`, 'm'));
    if (!match) throw new Error(`${name} not found in season.py`);
    return Number(match[1]);
  };

  it('starts the season in the same month', () => {
    expect(constant('SEASON_START_MONTH')).toBe(8);
    expect(isInSeason(utc('2026-08-01T00:00:00'))).toBe(true);
    expect(isInSeason(utc('2026-07-31T23:59:00'))).toBe(false);
  });

  it('ends the season on the same day', () => {
    expect(constant('SEASON_END_MONTH')).toBe(2);
    expect(constant('SEASON_END_DAY')).toBe(1);
    expect(isInSeason(utc('2026-02-01T12:00:00'))).toBe(true);
    expect(isInSeason(utc('2026-02-02T00:00:00'))).toBe(false);
  });
});
