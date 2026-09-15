// tests/app/api/nfl/proxy.test.ts

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GET } from '@/app/api/nfl/[...path]/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

// The route reads the session to decide whether the headshot column goes out.
// Importing the real @/auth would pull NextAuth's whole provider config in.
jest.mock('@/auth', () => ({ auth: jest.fn() }));

// The seasons endpoint reads a cached row rather than scanning the stat table —
// see lib/nflSeasons.ts. Mocked here so the route's own behaviour is what is
// under test; the cache itself is covered in tests/unit/lib/nflSeasons.test.ts.
const mockStatSeasons = jest.fn<() => Promise<number[]>>();
jest.mock('@/lib/nflSeasons', () => ({
  statSeasonsDescending: () => mockStatSeasons(),
}));

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

const mockQueryRaw = prisma.$queryRawUnsafe as jest.MockedFunction<
  typeof prisma.$queryRawUnsafe
>;
const mockAuth = auth as unknown as jest.MockedFunction<
  () => Promise<{ user?: unknown } | null>
>;

/** Signs the caller in (or out) for the next request. */
function session(signedIn: boolean) {
  mockAuth.mockResolvedValue(signedIn ? { user: { id: 'u1' } } : null);
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nfl/${path}`);
}

const mockLeaders = [
  {
    playerId: '4046',
    playerDisplayName: 'Tom Brady',
    position: 'QB',
    team: 'TB',
    headshot: null,
    statValue: 4200,
    gamesPlayed: 17,
  },
];

describe('GET /api/nfl/leaders', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockAuth.mockReset();
    // Most cases here are about the SQL, not the session; sign in by default so
    // the headshot tests below are the ones that speak about it.
    session(true);
  });

  it('returns aggregated leaders for the requested stat', async () => {
    mockQueryRaw.mockResolvedValueOnce(mockLeaders as never);

    const res = await GET(makeRequest('leaders?season=2025&stat=passingYards'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].playerDisplayName).toBe('Tom Brady');
    // season and limit are bound parameters, never interpolated.
    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining('SUM(passingYards)'),
      2025,
      25,
    );
  });

  it('rejects a stat column that is not on the allowlist', async () => {
    const res = await GET(
      makeRequest('leaders?season=2025&stat=password'),
      { params: Promise.resolve({ path: ['leaders'] }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid stat column/);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('ignores a position that is not a short alpha abbreviation', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest("leaders?season=2025&position=QB'%20OR%201=1--"), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.not.stringContaining('OR 1=1'),
      2025,
      25,
    );
  });

  it('applies a valid position filter', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&position=qb'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining("AND position = 'QB'"),
      2025,
      25,
    );
  });

  it('counts regular-season games only by default', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&stat=passingYards'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining("AND seasonType = 'REG'"),
      2025,
      25,
    );
  });

  it('folds the postseason in when includePlayoffs=true', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&includePlayoffs=true'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining("AND seasonType IN ('REG', 'POST')"),
      2025,
      25,
    );
  });

  it('treats any includePlayoffs value other than "true" as regular season', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&includePlayoffs=1'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(
      expect.stringContaining("AND seasonType = 'REG'"),
      2025,
      25,
    );
  });

  it('caps the limit at 100', async () => {
    mockQueryRaw.mockResolvedValueOnce([] as never);

    await GET(makeRequest('leaders?season=2025&limit=5000'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(mockQueryRaw).toHaveBeenCalledWith(expect.any(String), 2025, 100);
  });

  it('normalises bigint counts returned by Turso', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...mockLeaders[0], statValue: BigInt(4200), gamesPlayed: BigInt(17) },
    ] as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    const body = await res.json();
    expect(body[0].statValue).toBe(4200);
    expect(body[0].gamesPlayed).toBe(17);
  });

  it('returns 500 when the query throws', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DB connection failed/);
  });

  it('returns 404 for an unknown endpoint', async () => {
    const res = await GET(makeRequest('weekly'), {
      params: Promise.resolve({ path: ['weekly'] }),
    });

    expect(res.status).toBe(404);
  });

  // ── Headshots are members-only (issue #56) ─────────────────────────────────
  // The Statistics tab is public, and so is this route. Hiding the picture in
  // the component is not the same as not serving it, so these pin the wire.

  const withHeadshot = [{ ...mockLeaders[0], headshot: 'https://static.www.nfl.com/brady.png' }];

  it('withholds the headshot from a signed-out caller', async () => {
    session(false);
    mockQueryRaw.mockResolvedValueOnce(withHeadshot as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    const body = await res.json() as { headshot: string | null }[];
    expect(body[0].headshot).toBeNull();
    // Everything else still goes out — only the picture is members-only.
    expect(JSON.stringify(body)).not.toContain('nfl.com');
  });

  it('serves the headshot to a signed-in caller', async () => {
    session(true);
    mockQueryRaw.mockResolvedValueOnce(withHeadshot as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    const body = await res.json() as { headshot: string | null }[];
    expect(body[0].headshot).toBe('https://static.www.nfl.com/brady.png');
  });

  it('leaves the rest of the row intact for a signed-out caller', async () => {
    session(false);
    mockQueryRaw.mockResolvedValueOnce(withHeadshot as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    const body = await res.json() as Record<string, unknown>[];
    expect(body[0]).toMatchObject({
      playerId: '4046',
      playerDisplayName: 'Tom Brady',
      position: 'QB',
      team: 'TB',
      statValue: 4200,
      gamesPlayed: 17,
    });
  });

  it('treats a failed session lookup as signed out rather than 500ing', async () => {
    // The leaderboard answering signed-out visitors is the whole point of the
    // endpoint, so a broken session check must not take the public tab down.
    mockAuth.mockRejectedValue(new Error('AUTH_SECRET missing'));
    mockQueryRaw.mockResolvedValueOnce(withHeadshot as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { headshot: string | null }[];
    expect(body[0].headshot).toBeNull();
  });

  it('forbids a shared cache from replaying a signed-in response', async () => {
    session(true);
    mockQueryRaw.mockResolvedValueOnce(withHeadshot as never);

    const res = await GET(makeRequest('leaders?season=2025'), {
      params: Promise.resolve({ path: ['leaders'] }),
    });

    // Without this the gate is only as good as the nearest CDN.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not look up a session for the seasons endpoint', async () => {
    // /api/nfl/seasons carries no headshot, so it should not pay for a session.
    mockStatSeasons.mockResolvedValue([2025]);

    await GET(makeRequest('seasons'), {
      params: Promise.resolve({ path: ['seasons'] }),
    });

    expect(mockAuth).not.toHaveBeenCalled();
  });

  // WHY: this route is public and fires on every mount of the Statistics tab,
  //      and `DISTINCT season` has no index to lean on — it walked ~448,000
  //      rows to return two dozen integers. It was the second call site of the
  //      scan that emptied the database's read allowance, and it must not come
  //      back: the answer comes off a cached row now.
  it('serves the seasons from the cache, newest first, without scanning', async () => {
    mockStatSeasons.mockResolvedValue([2025, 2024, 2023]);
    const scan = jest.fn();
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = scan as never;

    const res = await GET(makeRequest('seasons'), {
      params: Promise.resolve({ path: ['seasons'] }),
    });

    expect(await res.json()).toEqual([2025, 2024, 2023]);
    expect(scan).not.toHaveBeenCalled();
  });
});
