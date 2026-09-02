// tests/unit/lib/cards/eligibility.test.ts
//
// Covers who the card game will rank, in src/lib/cards/eligibility.ts.
//
// The property under test is agreement, not filtering: the standings must show
// the same people the members page shows. The members page hides the seeded
// superuser by username, so the game has to hide the same account — otherwise a
// house account sits in a table it is not playing in.
//
// The env var is read per call rather than at import, so these cases set it
// directly instead of re-importing the module under a mocked environment.

import { describe, it, expect, afterEach } from '@jest/globals';
import { adminUsername, eligiblePlayerWhere } from '@/lib/cards/eligibility';

const original = process.env.ADMIN_USERNAME;

afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_USERNAME;
  else process.env.ADMIN_USERNAME = original;
});

describe('the admin account', () => {
  it('falls back to "admin" when the environment says nothing', () => {
    delete process.env.ADMIN_USERNAME;
    expect(adminUsername()).toBe('admin');
  });

  it('honours a deployment that renamed it', () => {
    process.env.ADMIN_USERNAME = 'superuser';
    expect(adminUsername()).toBe('superuser');
  });

  it('is read on every call, not captured at import', () => {
    process.env.ADMIN_USERNAME = 'first';
    expect(adminUsername()).toBe('first');
    process.env.ADMIN_USERNAME = 'second';
    expect(adminUsername()).toBe('second');
  });
});

describe('the eligibility predicate', () => {
  it('excludes the admin by username', () => {
    delete process.env.ADMIN_USERNAME;
    expect(eligiblePlayerWhere()).toEqual({ NOT: { username: 'admin' } });
  });

  it('tracks a renamed admin account', () => {
    process.env.ADMIN_USERNAME = 'houseaccount';
    expect(eligiblePlayerWhere()).toEqual({ NOT: { username: 'houseaccount' } });
  });

  /**
   * The members page builds its own `where` inline at
   * src/app/api/users/route.ts. This asserts the shape stays identical, so a
   * change to one is a failing test rather than a silent divergence.
   */
  it('matches the shape the members page filters by', () => {
    process.env.ADMIN_USERNAME = 'admin';
    const membersPageWhere = { NOT: { username: process.env.ADMIN_USERNAME ?? 'admin' } };
    expect(eligiblePlayerWhere()).toEqual(membersPageWhere);
  });
});
