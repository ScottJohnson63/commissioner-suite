// tests/unit/lib/cards/poolHeadshots.test.ts
//
// Covers which portrait rebuildCardPool writes onto a card.
//
// Kept apart from pool.test.ts, which mocks the database away entirely to test
// the ranking rule as a pure function. This is the other half of the builder:
// the join that decides what a card shows, and in particular that a *null*
// resolved portrait is an answer rather than a missing value.
//
// It matters because the raw nflverse column lies. Its nfl.com URL answers 200
// with the league's generic faceless-helmet silhouette for about half the pool,
// so trusting it put a black helmet on ~6,900 cards — and since a 200 is not an
// error, PlayerCard's onError fallback never fired to rescue them.

import { describe, it, expect, beforeEach } from '@jest/globals';

const queryRaw = jest.fn();
const headshotFindMany = jest.fn();
const rosterFindMany = jest.fn();
const createMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw:         (...args: unknown[]) => queryRaw(...args),
    nflSeasonRoster:   { findMany: (...args: unknown[]) => rosterFindMany(...args) },
    nflPlayerHeadshot: { findMany: (...args: unknown[]) => headshotFindMany(...args) },
    cardDefinition: {
      findMany:   jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: (...args: unknown[]) => createMany(...args),
    },
  },
}));

import { rebuildCardPool } from '@/lib/cards/pool';

const SILHOUETTE = 'https://static.www.nfl.com/image/private/f_auto,q_auto/league/silhouette';
const ESPN = 'https://a.espncdn.com/i/headshots/nfl/players/full/1755.png';

/** The one stat row every test in here builds its single card from. */
function statRow(overrides: Record<string, unknown> = {}) {
  return {
    playerId:      '00-0001',
    playerName:    'Edgerrin James',
    position:      'RB',
    team:          'IND',
    fantasyPoints: 300,
    gamesPlayed:   16,
    headshot:      SILHOUETTE,
    ...overrides,
  };
}

/** A card as the builder writes it — the portrait and the credit beside it. */
interface WrittenCard {
  playerId: string;
  headshot: string | null;
  photoAuthor: string | null;
  photoLicense: string | null;
  photoLicenseUrl: string | null;
  photoFileUrl: string | null;
}

/** Every card handed to createMany across the run, flattened. */
function writtenCards(): WrittenCard[] {
  return createMany.mock.calls.flatMap(
    (call) => (call[0] as { data: WrittenCard[] }).data,
  );
}

/** A resolved Wikimedia portrait, credit and all. */
const COMMONS = {
  playerId:   '00-0001',
  url:        'https://upload.wikimedia.org/wikipedia/commons/1/1a/Edgerrin_James.jpg',
  author:     'Jane Doe',
  license:    'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  fileUrl:    'https://commons.wikimedia.org/wiki/File:Edgerrin_James.jpg',
};

/** Wires $queryRaw to answer both of the builder's raw queries. */
function withStats(rows: ReturnType<typeof statRow>[]) {
  queryRaw.mockImplementation((strings: TemplateStringsArray) =>
    strings.join('').includes('DISTINCT season')
      ? Promise.resolve([{ season: 2003 }])
      : Promise.resolve(rows),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  rosterFindMany.mockResolvedValue([]);
  headshotFindMany.mockResolvedValue([]);
});

describe('rebuildCardPool() portraits', () => {
  // WHY: the recovery this whole change exists for. The stat table still holds
  //      the silhouette URL — it is synced data and is not rewritten — so the
  //      resolved portrait has to win, or the ESPN photograph never reaches a
  //      card.
  it('prefers the resolved portrait over the raw nflverse column', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{ playerId: '00-0001', url: ESPN }]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBe(ESPN);
  });

  // WHY: the subtle half. A resolved row holding null means "checked, and no
  //      photograph exists anywhere" — the signal that sends the card to its
  //      team logo. Read as a miss it would fall back to the silhouette URL,
  //      which is exactly the bug, so `has` and `??` are not interchangeable
  //      here.
  it('treats a resolved null as no photograph rather than as a miss', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{ playerId: '00-0001', url: null }]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBeNull();
  });

  // WHY: the table is filled by a separate sync, so a checkout that has never
  //      run it must still build a usable pool rather than a deck of logos.
  it('falls back to the raw column for a player nobody has checked', async () => {
    withStats([statRow()]);

    await rebuildCardPool();

    expect(writtenCards()[0].headshot).toBe(SILHOUETTE);
  });

  // WHY: most Wikimedia portraits are CC BY-SA, which is free to show and not
  //      free to show uncredited. The card reads CardDefinition, so a credit
  //      the builder drops here is a credit that cannot be printed anywhere —
  //      and the card renders perfectly without it, so nothing would say so.
  it('carries the credit onto the card beside the portrait', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([COMMONS]);

    await rebuildCardPool();

    expect(writtenCards()[0]).toMatchObject({
      headshot:        COMMONS.url,
      photoAuthor:     'Jane Doe',
      photoLicense:    'CC BY-SA 4.0',
      photoLicenseUrl: COMMONS.licenseUrl,
      photoFileUrl:    COMMONS.fileUrl,
    });
  });

  // WHY: the credit belongs to the picture. A player whose Wikimedia portrait
  //      has since been replaced by an nfl.com headshot must lose the credit
  //      with it, or the card attributes a league photograph to a Commons
  //      uploader — a false statement, and a worse failure than no credit.
  it('writes no credit for a portrait that needs none', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{
      playerId: '00-0001', url: ESPN,
      author: null, license: null, licenseUrl: null, fileUrl: null,
    }]);

    await rebuildCardPool();

    expect(writtenCards()[0]).toMatchObject({
      headshot:        ESPN,
      photoAuthor:     null,
      photoLicense:    null,
      photoLicenseUrl: null,
      photoFileUrl:    null,
    });
  });

  // WHY: a checkout whose headshot sync predates the credit columns has rows
  //      with a URL and nothing else. That must build a card with a picture
  //      and no credit, not undefined columns Prisma would reject.
  it('writes nulls for a row that predates the credit columns', async () => {
    withStats([statRow()]);
    headshotFindMany.mockResolvedValue([{ playerId: '00-0001', url: ESPN }]);

    await rebuildCardPool();

    expect(writtenCards()[0].photoAuthor).toBeNull();
    expect(writtenCards()[0].photoFileUrl).toBeNull();
  });
});
