// tests/app/api/sleeper/user/route.test.ts
//
// Tests for GET /api/sleeper/user.
// Mocks @/lib/sleeper/client so no real Sleeper API calls are made.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/sleeper/client', () => ({
  SLEEPER_BASE: 'https://api.sleeper.app/v1',
  sleeperGet: jest.fn(),
}));

import { GET } from '@/app/api/sleeper/user/route';
import { sleeperGet } from '@/lib/sleeper/client';

const mockSleeperGet = sleeperGet as jest.MockedFunction<typeof sleeperGet>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeUser = {
  user_id:      'uid-42',
  username:     'testuser',
  display_name: 'Test User',
  avatar:       'abc123',
};

const fakeLeagues = [
  {
    league_id:    '999',
    name:         'My League',
    season:       '2025',
    total_rosters: 10,
    status:       'in_season',
    settings:     { playoff_week_start: 15 },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGet(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/sleeper/user${qs}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/sleeper/user', () => {
  beforeEach(() => {
    mockSleeperGet.mockReset();
  });

  // WHY: Neither username nor userId provided — return 400 immediately so the
  //      client knows which parameter it's missing.
  it('returns 400 when neither username nor userId is provided', async () => {
    const res = await GET(makeGet(''));
    expect(res.status).toBe(400);
    expect(mockSleeperGet).not.toHaveBeenCalled();
  });

  // WHY: userId is preferred over username per Sleeper docs (more stable).
  //      When provided, the fetch must use /user/{userId}.
  it('fetches by userId when provided', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(fakeUser)    // user lookup
      .mockResolvedValueOnce(fakeLeagues); // leagues lookup

    const res = await GET(makeGet('?userId=uid-42'));
    expect(res.status).toBe(200);

    // Verify the first sleeperGet call used the userId path
    expect(mockSleeperGet).toHaveBeenCalledWith(
      expect.stringContaining('/user/uid-42'),
    );
  });

  // WHY: When only username is provided, the fetch must use /user/{username}.
  it('fetches by username when userId is absent', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(fakeUser)
      .mockResolvedValueOnce(fakeLeagues);

    const res = await GET(makeGet('?username=testuser'));
    expect(res.status).toBe(200);

    expect(mockSleeperGet).toHaveBeenCalledWith(
      expect.stringContaining('/user/testuser'),
    );
  });

  // WHY: A valid response must include userId, username, displayName, avatar,
  //      and mapped leagues so the client has everything needed to display the user.
  it('returns correct user and leagues on success', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(fakeUser)
      .mockResolvedValueOnce(fakeLeagues);

    const res = await GET(makeGet('?userId=uid-42'));
    const body = await res.json() as {
      userId: string; username: string; leagues: Array<{ leagueId: string }>;
    };

    expect(body.userId).toBe('uid-42');
    expect(body.username).toBe('testuser');
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0].leagueId).toBe('999');
  });

  // WHY: If sleeperGet throws with a 404 message, the route must return 404
  //      (user genuinely not found) rather than 502 (API error).
  it('returns 404 when Sleeper user is not found', async () => {
    mockSleeperGet.mockRejectedValueOnce(new Error('Sleeper 404: /user/ghost'));

    const res = await GET(makeGet('?username=ghost'));
    expect(res.status).toBe(404);
  });

  // WHY: Non-404 Sleeper errors (e.g. 500, 429) indicate the API is having
  //      trouble — return 502 Bad Gateway so the client knows it's upstream.
  it('returns 502 for non-404 Sleeper errors', async () => {
    mockSleeperGet.mockRejectedValueOnce(new Error('Sleeper 500: /user/uid-42'));

    const res = await GET(makeGet('?userId=uid-42'));
    expect(res.status).toBe(502);
  });
});
