// tests/unit/lib/sleeper/sync.test.ts
//
// Replaces the old console-script at src/lib/sleeper/sync.test.ts.
// Tests fetchLeagueData() and syncLeague() in src/lib/sleeper/sync.ts.
// Mocks sleeperGet, prisma, and the audit log so nothing leaves the process.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Sleeper client module before importing the module under test.
// jest.mock is hoisted, so it runs before any imports.
jest.mock('@/lib/sleeper/client', () => ({
  // Keep SLEEPER_BASE and the SLEEPER_TTL table real; only the fetch is faked.
  ...jest.requireActual<typeof import('@/lib/sleeper/client')>('@/lib/sleeper/client'),
  sleeperGet: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    league: { upsert: jest.fn() },
    team:   { upsert: jest.fn() },
  },
}));

jest.mock('@/lib/audit', () => ({ writeAuditLog: jest.fn() }));

import { fetchLeagueData, syncLeague } from '@/lib/sleeper/sync';
import { sleeperGet } from '@/lib/sleeper/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

const mockSleeperGet   = sleeperGet    as jest.MockedFunction<typeof sleeperGet>;
const mockLeagueUpsert = prisma.league.upsert as jest.MockedFunction<typeof prisma.league.upsert>;
const mockTeamUpsert   = prisma.team.upsert   as jest.MockedFunction<typeof prisma.team.upsert>;
const mockAuditLog     = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Minimal Sleeper league response with 2 divisions.
const leaguePayload = {
  league_id: '999',
  name:      'Test League',
  season:    '2025',
  settings:  { divisions: 2 },
};

// 10 rosters — 5 in division 1 (→ divisionId 0), 5 in division 2 (→ divisionId 1).
const rostersPayload = [
  { roster_id: 1, owner_id: 'u1', settings: { division: 1 } },
  { roster_id: 2, owner_id: 'u2', settings: { division: 1 } },
  { roster_id: 3, owner_id: 'u3', settings: { division: 1 } },
  { roster_id: 4, owner_id: 'u4', settings: { division: 1 } },
  { roster_id: 5, owner_id: 'u5', settings: { division: 1 } },
  { roster_id: 6, owner_id: 'u6', settings: { division: 2 } },
  { roster_id: 7, owner_id: 'u7', settings: { division: 2 } },
  { roster_id: 8, owner_id: 'u8', settings: { division: 2 } },
  { roster_id: 9, owner_id: 'u9', settings: { division: 2 } },
  { roster_id: 10, owner_id: 'u10', settings: { division: 2 } },
];

// Users with both team_name metadata and display_name available.
const usersPayload = rostersPayload.map((r, i) => ({
  user_id:      r.owner_id,
  display_name: `DisplayName${i + 1}`,
  metadata:     { team_name: `TeamName${i + 1}` },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchLeagueData()', () => {
  beforeEach(() => {
    // Reset mock call history before each test.
    mockSleeperGet.mockReset();
  });

  // WHY: Happy-path smoke test — verifies the returned shape matches what the
  //      DB upsert caller in /api/leagues/sync expects.
  it('returns a well-formed result on the happy path', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)  // /league/:id
      .mockResolvedValueOnce(rostersPayload) // /league/:id/rosters
      .mockResolvedValueOnce(usersPayload);  // /league/:id/users

    const result = await fetchLeagueData('999');

    expect(result.leagueId).toBe('999');
    expect(result.name).toBe('Test League');
    expect(result.season).toBe(2025);
    expect(result.teams).toHaveLength(10);
  });

  // WHY: team_name in metadata is the custom name the manager set in Sleeper —
  //      it should be preferred over display_name and the generic fallback.
  it('uses metadata.team_name when available', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersPayload);

    const { teams } = await fetchLeagueData('999');
    // All users have team_name set in this fixture
    expect(teams[0].name).toBe('TeamName1');
  });

  // WHY: When team_name is absent, display_name is the next best identifier.
  //      Tests the fallback chain: team_name → display_name.
  it('falls back to display_name when team_name is absent', async () => {
    // Strip team_name from the first user only
    const usersNoTeamName = usersPayload.map((u, i) =>
      i === 0 ? { ...u, metadata: {} } : u,
    );
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersNoTeamName);

    const { teams } = await fetchLeagueData('999');
    expect(teams[0].name).toBe('DisplayName1');
  });

  // WHY: When the user has no metadata at all, display_name is still the fallback.
  //      Covers the optional chaining on user?.metadata?.team_name.
  it('uses display_name when metadata is absent entirely', async () => {
    const usersNoMeta = usersPayload.map((u, i) =>
      i === 0 ? { user_id: u.user_id, display_name: u.display_name } : u,
    );
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersNoMeta);

    const { teams } = await fetchLeagueData('999');
    expect(teams[0].name).toBe('DisplayName1');
  });

  // WHY: If the user is not found in the users array at all, the code falls back
  //      to "Team N" using the roster_id. Prevents a crash on orphaned rosters.
  it('uses "Team N" fallback when owner has no user record', async () => {
    // Remove user u1 from the users list so roster 1 has no owner record.
    const usersWithout1 = usersPayload.filter((u) => u.user_id !== 'u1');
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersWithout1);

    const { teams } = await fetchLeagueData('999');
    // roster_id 1 has no owner → fallback to "Team 1"
    const orphan = teams.find((t) => t.id === '1');
    expect(orphan?.name).toBe('Team 1');
  });

  // WHY: Sleeper divisions are 1-indexed. The scheduler engine uses 0-indexed
  //      divisionId (0 | 1). Wrong conversion would put all teams in the wrong division.
  it('converts Sleeper division 1 → divisionId 0 and division 2 → divisionId 1', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersPayload);

    const { teams } = await fetchLeagueData('999');

    const div0Teams = teams.filter((t) => t.divisionId === 0);
    const div1Teams = teams.filter((t) => t.divisionId === 1);
    // rosters 1–5 have settings.division=1 → divisionId 0
    expect(div0Teams).toHaveLength(5);
    // rosters 6–10 have settings.division=2 → divisionId 1
    expect(div1Teams).toHaveLength(5);
  });

  // WHY: The engine is hard-coded for 2 divisions. A league with 1 or 3 divisions
  //      must be rejected immediately rather than producing corrupt schedule data.
  it('throws when the league does not have exactly 2 divisions', async () => {
    const oneDivLeague = { ...leaguePayload, settings: { divisions: 1 } };
    mockSleeperGet
      .mockResolvedValueOnce(oneDivLeague)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersPayload);

    await expect(fetchLeagueData('999')).rejects.toThrow(
      'Expected 2 divisions',
    );
  });

  // WHY: The season field from Sleeper is a string (e.g. "2025"). The DB column
  //      and the schedule engine both expect a number — verify the conversion.
  it('coerces the season string to a number', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersPayload);

    const { season } = await fetchLeagueData('999');
    expect(typeof season).toBe('number');
    expect(season).toBe(2025);
  });

  // WHY: All three Sleeper endpoints must be called. Skipping any would mean
  //      missing data (e.g. no rosters → no teams → schedule generation fails).
  it('calls sleeperGet three times (league + rosters + users)', async () => {
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload)
      .mockResolvedValueOnce(rostersPayload)
      .mockResolvedValueOnce(usersPayload);

    await fetchLeagueData('999');
    expect(mockSleeperGet).toHaveBeenCalledTimes(3);
  });
});

describe('syncLeague()', () => {
  beforeEach(() => {
    mockLeagueUpsert.mockReset();
    mockTeamUpsert.mockReset();
    mockAuditLog.mockReset();

    mockSleeperGet.mockReset();
    mockSleeperGet
      .mockResolvedValueOnce(leaguePayload as never)
      .mockResolvedValueOnce(rostersPayload as never)
      .mockResolvedValueOnce(usersPayload as never);

    mockLeagueUpsert.mockResolvedValue({ id: 'db-lg-1' } as never);
    mockTeamUpsert.mockResolvedValue({} as never);
    mockAuditLog.mockResolvedValue(undefined as never);
  });

  // WHY: The League row is keyed on sleeperLeagueId so repeated syncs update
  //      rather than duplicate.
  it('upserts the league keyed on sleeperLeagueId', async () => {
    await syncLeague('999');

    expect(mockLeagueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperLeagueId: '999' } }),
    );
  });

  // WHY: Every roster must land as a Team row, or the schedule generator will
  //      build a bracket that is missing managers.
  it('upserts one team per roster', async () => {
    const result = await syncLeague('999');

    expect(mockTeamUpsert).toHaveBeenCalledTimes(rostersPayload.length);
    expect(result.teamCount).toBe(rostersPayload.length);
  });

  // WHY: The Activity Log is how a commissioner sees that a sync happened.
  it('writes a SYNC audit entry against the local league id', async () => {
    await syncLeague('999');

    expect(mockAuditLog).toHaveBeenCalledWith('SYNC', 'db-lg-1', expect.anything());
  });

  // WHY: A league that fails validation must not leave half-written rows.
  it('does not touch the database when the league fails validation', async () => {
    mockSleeperGet.mockReset();
    mockSleeperGet
      .mockResolvedValueOnce({ ...leaguePayload, settings: { divisions: 3 } } as never)
      .mockResolvedValueOnce(rostersPayload as never)
      .mockResolvedValueOnce(usersPayload as never);

    await expect(syncLeague('999')).rejects.toThrow(/Expected 2 divisions/);
    expect(mockLeagueUpsert).not.toHaveBeenCalled();
    expect(mockTeamUpsert).not.toHaveBeenCalled();
  });
});
