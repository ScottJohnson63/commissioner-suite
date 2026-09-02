// tests/unit/lib/cards/customize.test.ts
//
// Covers src/lib/cards/customize.ts — naming a card, giving it a picture, and
// the one thing that earns a pack.
//
// The rule this file exists to pin: **a pack is paid for giving a faceless card
// a face, and nothing else.** Not for a nickname, not for replacing a portrait
// the pool already had, and not twice for the same card. Getting that wrong in
// the generous direction hands out packs, and packs are cards permanently out
// of a pool that runs out.
//
// The second rule is where an upload lands. A contributed portrait goes to
// CardPortrait and survives the season reset; an override goes to CardImage and
// does not. The caller does not choose — that is decided here, and choosing
// wrongly either destroys a contribution or makes a joke permanent.

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockOwnership = {
  findFirst: jest.fn<() => Promise<unknown>>(),
  update:    jest.fn<(a?: unknown) => Promise<unknown>>(),
};
const mockDefinition = { findUnique: jest.fn<() => Promise<unknown>>() };
const mockPortrait = {
  findUnique: jest.fn<() => Promise<unknown>>(),
  create:     jest.fn<(a?: unknown) => Promise<unknown>>(),
  count:      jest.fn<() => Promise<number>>(),
};
const mockImage = {
  findUnique: jest.fn<() => Promise<unknown>>(),
  upsert:     jest.fn<(a?: unknown) => Promise<unknown>>(),
  deleteMany: jest.fn<(a?: unknown) => Promise<unknown>>(),
};
const mockPackGrant = { updateMany: jest.fn<(a?: unknown) => Promise<unknown>>() };
const mockEnsureGrant = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cardOwnership: {
      findFirst: () => mockOwnership.findFirst(),
      update:    (a: unknown) => mockOwnership.update(a),
    },
    cardDefinition: { findUnique: () => mockDefinition.findUnique() },
    cardPortrait: {
      findUnique: () => mockPortrait.findUnique(),
      create:     (a: unknown) => mockPortrait.create(a),
      count:      () => mockPortrait.count(),
    },
    cardImage: {
      findUnique: () => mockImage.findUnique(),
      upsert:     (a: unknown) => mockImage.upsert(a),
      deleteMany: (a: unknown) => mockImage.deleteMany(a),
    },
    packGrant: { updateMany: (a: unknown) => mockPackGrant.updateMany(a) },
  },
}));
jest.mock('@/lib/cards/allowance', () => ({
  ensureGrant: (...args: unknown[]) => mockEnsureGrant(...args),
}));

import {
  customizeCard, normalizeNickname, validateImage, isUnillustrated,
  MAX_NICKNAME_LENGTH, MAX_IMAGE_BYTES, MAX_CUSTOMIZATION_PACKS,
} from '@/lib/cards/customize';

const IMAGE = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };

beforeEach(() => {
  jest.clearAllMocks();
  mockOwnership.findFirst.mockResolvedValue({ id: 'o1', nickname: null });
  mockOwnership.update.mockResolvedValue({});
  // Default: a card with no photograph and no contributed portrait.
  mockDefinition.findUnique.mockResolvedValue({ headshot: null });
  mockPortrait.findUnique.mockResolvedValue(null);
  mockPortrait.create.mockResolvedValue({});
  mockPortrait.count.mockResolvedValue(0);
  mockImage.findUnique.mockResolvedValue(null);
  mockImage.upsert.mockResolvedValue({});
  mockImage.deleteMany.mockResolvedValue({});
  mockPackGrant.updateMany.mockResolvedValue({});
  mockEnsureGrant.mockResolvedValue({});
});

describe('isUnillustrated()', () => {
  // WHY: the whole eligibility test rests on this. An empty string is what a
  //      missing headshot looks like in some rows, and treating it as a photo
  //      would silently make ~1,900 cards ineligible for the reward.
  it('treats null and empty as having no photograph', () => {
    expect(isUnillustrated(null)).toBe(true);
    expect(isUnillustrated(undefined)).toBe(true);
    expect(isUnillustrated('')).toBe(true);
  });

  it('treats a URL as having one', () => {
    expect(isUnillustrated('https://x/y.png')).toBe(false);
  });
});

describe('normalizeNickname()', () => {
  // WHY: empty and absent must collapse to the same state. A nickname of ''
  //      would read as present to any truthiness check, so a card could look
  //      complete — and pay a pack — on a blank name.
  it('turns blank into null', () => {
    expect(normalizeNickname('')).toBeNull();
    expect(normalizeNickname('   ')).toBeNull();
    expect(normalizeNickname(null)).toBeNull();
    expect(normalizeNickname(undefined)).toBeNull();
  });

  it('trims surrounding space', () => {
    expect(normalizeNickname('  The Bus  ')).toBe('The Bus');
  });

  it('rejects a nickname past the limit', () => {
    expect(() => normalizeNickname('x'.repeat(MAX_NICKNAME_LENGTH + 1))).toThrow(/at most/);
  });

  it('accepts one exactly at the limit', () => {
    const name = 'x'.repeat(MAX_NICKNAME_LENGTH);
    expect(normalizeNickname(name)).toBe(name);
  });

  it('rejects a non-string', () => {
    expect(() => normalizeNickname(42)).toThrow(/must be text/);
  });
});

describe('validateImage()', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('accepts an allowed type', () => {
    expect(validateImage(bytes, 'image/jpeg')).toEqual({ bytes, mimeType: 'image/jpeg' });
  });

  // WHY: this is the security case, not a validation nicety. The stored type is
  //      replayed as the response Content-Type, and an SVG is a script host —
  //      so an SVG portrait served from our own origin is stored XSS.
  it('refuses SVG', () => {
    expect(() => validateImage(bytes, 'image/svg+xml')).toThrow(/JPEG, PNG or WebP/);
  });

  it('refuses a missing type', () => {
    expect(() => validateImage(bytes, '')).toThrow(/JPEG, PNG or WebP/);
  });

  it('refuses an empty file', () => {
    expect(() => validateImage(new Uint8Array(0), 'image/png')).toThrow(/empty/);
  });

  // WHY: there is no object storage, so an oversized upload lands in the
  //      database row itself. The cap is the only thing bounding that.
  it('refuses an image over the size cap', () => {
    expect(() => validateImage(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png'))
      .toThrow(/under/);
  });

  it('accepts one exactly at the cap', () => {
    expect(() => validateImage(new Uint8Array(MAX_IMAGE_BYTES), 'image/png')).not.toThrow();
  });
});

describe('customizeCard()', () => {
  // WHY: not owning a card and the card not existing must be indistinguishable,
  //      or this becomes a way to enumerate what other members hold.
  it('returns null for a card the member does not own', async () => {
    mockOwnership.findFirst.mockResolvedValue(null);
    expect(await customizeCard('u1', 'c1', 2026, 3, { nickname: 'Bus' })).toBeNull();
    expect(mockOwnership.update).not.toHaveBeenCalled();
  });

  // ── The reward rule ──────────────────────────────────────────────────────

  // WHY: the nickname is explicitly not part of the reward. It is a rename, it
  //      is free, and it resets with the ownership it sits on.
  it('pays nothing for a nickname', async () => {
    const result = await customizeCard('u1', 'c1', 2026, 3, { nickname: 'The Bus' });
    expect(result!.packsAwarded).toBe(0);
    expect(mockPortrait.create).not.toHaveBeenCalled();
    expect(mockPackGrant.updateMany).not.toHaveBeenCalled();
  });

  // WHY: the rule in one line — a pack is for giving a faceless card a face.
  it('pays a pack for a picture on a card with no photograph', async () => {
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(result!.packsAwarded).toBe(1);
    expect(result!.isContributed).toBe(true);
    expect(mockPackGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { packsGranted: { increment: 1 } } }),
    );
  });

  // WHY: the restraint. Replacing a portrait the pool already had is
  //      decoration, however much better the new one is.
  it('pays nothing for a picture on a card that already has one', async () => {
    mockDefinition.findUnique.mockResolvedValue({ headshot: 'https://x/y.png' });
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(result!.packsAwarded).toBe(0);
    expect(result!.eligibleForReward).toBe(false);
    expect(mockPortrait.create).not.toHaveBeenCalled();
  });

  // WHY: once the card has a contributed face it is no longer faceless, so the
  //      next person to upload is replacing, not contributing.
  it('pays nothing once somebody has already contributed a portrait', async () => {
    mockPortrait.findUnique.mockResolvedValue({ id: 'p1' });
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(result!.packsAwarded).toBe(0);
    expect(result!.eligibleForReward).toBe(false);
    expect(mockImage.upsert).toHaveBeenCalled();
  });

  // WHY: the unique key on cardId is the idempotence. Two tabs uploading the
  //      same card both reach the insert and only one may be paid.
  it('pays nothing when it loses the race to contribute', async () => {
    mockPortrait.create.mockRejectedValue(new Error('UNIQUE constraint failed'));
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(result!.packsAwarded).toBe(0);
    expect(mockPackGrant.updateMany).not.toHaveBeenCalled();
  });

  // WHY: the cap is a pool-safety limit — see the note on the constant. Past
  //      it an upload still works, it just stops paying and stops being
  //      permanent, which is the honest degradation.
  it('stops paying at the season cap and stores an override instead', async () => {
    mockPortrait.count.mockResolvedValue(MAX_CUSTOMIZATION_PACKS);
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(result!.packsAwarded).toBe(0);
    expect(result!.rewardsRemaining).toBe(0);
    expect(mockPortrait.create).not.toHaveBeenCalled();
    expect(mockImage.upsert).toHaveBeenCalled();
  });

  it('creates the week grant before crediting it', async () => {
    await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(mockEnsureGrant).toHaveBeenCalledWith('u1', 2026, 3);
  });

  // ── Where an upload lands ────────────────────────────────────────────────

  // WHY: a contributed portrait must go to the permanent table. Landing it in
  //      CardImage would have the season reset destroy the only face that card
  //      will ever have.
  it('stores a contributed portrait permanently, not as an override', async () => {
    await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(mockPortrait.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cardId: 'c1', contributedBy: 'u1', contributedSeason: 2026, mimeType: 'image/jpeg',
        }),
      }),
    );
    expect(mockImage.upsert).not.toHaveBeenCalled();
  });

  // WHY: the mirror. A joke on a card that already has a face must not outlive
  //      the season it was made in.
  it('stores an override season-scoped, not permanently', async () => {
    mockDefinition.findUnique.mockResolvedValue({ headshot: 'https://x/y.png' });
    await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(mockImage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gameSeason_cardId: { gameSeason: 2026, cardId: 'c1' } },
      }),
    );
    expect(mockPortrait.create).not.toHaveBeenCalled();
  });

  // WHY: a contributed portrait is not the uploader's to withdraw — it belongs
  //      to the card, and they may not own it next season.
  it('clears only the override, never a contributed portrait', async () => {
    mockPortrait.findUnique.mockResolvedValue({ id: 'p1' });
    const result = await customizeCard('u1', 'c1', 2026, 3, { image: null });
    expect(mockImage.deleteMany).toHaveBeenCalledWith(
      { where: { gameSeason: 2026, cardId: 'c1' } },
    );
    expect(result!.hasCustomImage).toBe(true);
  });

  // ── Leaving things alone ─────────────────────────────────────────────────

  // WHY: undefined means "leave alone" and null means "clear". Collapsing them
  //      would make an upload wipe the nickname on every save.
  it('does not touch the nickname when it is not given', async () => {
    await customizeCard('u1', 'c1', 2026, 3, { image: IMAGE });
    expect(mockOwnership.update).not.toHaveBeenCalled();
  });

  it('does not touch the picture when it is not given', async () => {
    await customizeCard('u1', 'c1', 2026, 3, { nickname: 'Bus' });
    expect(mockImage.upsert).not.toHaveBeenCalled();
    expect(mockImage.deleteMany).not.toHaveBeenCalled();
    expect(mockPortrait.create).not.toHaveBeenCalled();
  });
});
