// src/lib/cards/customize.ts
//
// Making a card yours: a nickname, a picture, and what one of those earns.
//
// Two things a member can change about a card they own, and neither touches the
// pool. `CardDefinition` is a projection rebuilt wholesale from the stat table —
// anything written onto it is lost on the next rebuild.
//
// **An upload is one of two different things**, and which one it is depends
// entirely on whether the card already had a face:
//
//   Contributed portrait — the card had no photograph anywhere. About 1,900 of
//     them do not: nfl.com serves the generic silhouette, ESPN 404s them, and
//     Wikipedia has no article image, so they render a team logo. Giving one of
//     these a face is a contribution to the pool rather than decoration, so it
//     **earns a pack** and is **permanent** — it lives in CardPortrait, which
//     the season reset does not touch, and next season's owner inherits it.
//
//   Vanity override — the card already had a face, whether the pool's own or a
//     portrait somebody contributed earlier. Replacing it earns nothing and is
//     season-scoped: it lives in CardImage, which the reset clears.
//
// The nickname is not part of the reward at all. It is a rename, it is free,
// and it resets with the ownership it sits on.
//
// One pack per faceless card given a face. The `cardId` uniqueness on
// CardPortrait is what makes that once ever — the insert either wins or it
// does not, so two tabs uploading the same card cannot both be paid.

import { prisma } from '@/lib/prisma';
import { ensureGrant } from '@/lib/cards/allowance';

/**
 * Whether a card came with no portrait, and so is one the reward is for.
 *
 * The pool's own `headshot` is the test. A card with a photograph is already
 * illustrated, and paying somebody to cover it up is not what this is for.
 */
export function isUnillustrated(headshot: string | null | undefined): boolean {
  return !headshot;
}

/**
 * Packs paid for giving one faceless card a face.
 *
 * One, because the cap below is what sizes the reward — a bigger per-card
 * figure would just reach the cap sooner and make the last contributions feel
 * worthless.
 */
export const PACKS_PER_CUSTOMIZATION = 1;

/**
 * The most a member can earn this way in a season.
 *
 * **This number is a pool-safety limit, not a game-feel one.** Ownership is
 * exclusive, so every extra pack is cards permanently out of everyone else's
 * reach, and Silver is the tier that runs out first — 2,160 cards against a
 * dealt mix that is 28.6% Silver. A tier that empties is dropped from
 * `rollPackTier` entirely, which collapses the game back to Bronze mid-season.
 *
 * Sized against a 70% Silver ceiling for a **ten-member** league, counting
 * every supply — the ration, the starter grant, the wildcards those pull, and
 * the Sleeper bonus. Silver drained over a season, by how often a member wins
 * one of the two weekly bonuses:
 *
 *   | cap | no bonuses | 25% | 50% | 75% |
 *   |-----|-----------|-----|-----|-----|
 *   | 0   | 38%       | 46% | 54% | 62% |
 *   | 15  | 52%       | 60% | 69% | 77% |
 *   | 20  | 57%       | 65% | 73% | 82% |
 *
 * 50% is the realistic planning figure: a member wins about half their matchups
 * by definition, and 100 PPR points is a low bar. Fifteen is the largest round
 * number holding the ceiling there.
 *
 * This was briefly 6, sized when the Sleeper bonus was still a ten-card pack
 * with a Silver floor — that one pack drew 3.26 Silver against an ordinary
 * pack's 1.43 and ate most of the budget on its own. Normalising it to an
 * ordinary five-card pack is what paid for the cap being this size.
 *
 * ⚠️ **Sized for ten members.** At twelve the same cap puts Silver at 82%, past
 * the ceiling — a growing league should drop this to about 4, or find the room
 * somewhere else. The figures fold in a ×1.46 wildcard multiplier, because
 * reward packs pull dice of their own and compound.
 *
 * Raising this means re-running that arithmetic. See docs/CARDS.md.
 */
export const MAX_CUSTOMIZATION_PACKS = 15;

/** Longest nickname accepted. Long enough for a joke, short enough for the band. */
export const MAX_NICKNAME_LENGTH = 32;

/**
 * Largest portrait accepted, in bytes of decoded image.
 *
 * The app has no object storage, so an upload is stored inline on the ownership
 * row as a data URI. 256 KB is comfortably more than the card needs — it renders
 * at most ~320px wide — and small enough that a member customizing the cap's
 * worth of cards adds about 5 MB to the database rather than 50.
 *
 * The client downscales before sending; this is the backstop for a client that
 * does not.
 */
export const MAX_IMAGE_BYTES = 256 * 1024;

/** Image formats a card portrait may be in. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface CustomizationResult {
  nickname: string | null;
  /** True when a picture is stored for this card, of either kind. */
  hasCustomImage: boolean;
  /**
   * True when the stored picture is a permanent contributed portrait rather
   * than a season-scoped override — so the UI can say it will outlive the reset.
   */
  isContributed: boolean;
  /**
   * Whether uploading to this card would earn a pack: it has no portrait of its
   * own and nobody has contributed one. Surfaced so the UI can say so before
   * somebody uploads expecting a pack.
   */
  eligibleForReward: boolean;
  /** Packs paid by this call — non-zero only on the request that earned it. */
  packsAwarded: number;
  /** Packs this member has earned this way all season, after this call. */
  packsEarnedTotal: number;
  /** Cards that can still earn, or 0 at the cap. */
  rewardsRemaining: number;
}

/**
 * Trims and validates a nickname.
 *
 * Empty becomes null rather than an empty string, so "clear it" and "never set
 * it" are the same state.
 *
 * @throws Error when the nickname is longer than MAX_NICKNAME_LENGTH.
 */
export function normalizeNickname(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error('Nickname must be text');

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_NICKNAME_LENGTH) {
    throw new Error(`Nicknames are at most ${MAX_NICKNAME_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Validates an uploaded picture.
 *
 * The type is taken from the upload's own declared type and checked against the
 * allowlist rather than trusted. It is stored and later replayed as the
 * response Content-Type, so an arbitrary one would let a card portrait be
 * served as `image/svg+xml` — and an SVG is a script host.
 *
 * Returns the pieces rather than a data URI, because both tables keep the bytes
 * and the type in separate columns so GET /api/cards/image can set a real
 * Content-Type instead of parsing a URI back apart.
 *
 * @throws Error when the type is not allowed or the image is too large.
 */
export function validateImage(
  bytes: Uint8Array, mimeType: string,
): { bytes: Uint8Array; mimeType: string } {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error(`Images must be JPEG, PNG or WebP — got ${mimeType || 'nothing'}`);
  }
  if (bytes.byteLength === 0) throw new Error('That image is empty');
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Images must be under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB — that one is ` +
      `${Math.round(bytes.byteLength / 1024)} KB`,
    );
  }
  return { bytes, mimeType };
}

/**
 * Packs a member has earned by contributing portraits, this season.
 *
 * Counted off CardPortrait rather than a separate ledger: a contributed
 * portrait *is* the receipt, and one cannot exist without having been paid for.
 * `contributedSeason` is what scopes it to the cap's season — the rows
 * themselves are permanent.
 */
export async function packsEarned(userId: string, season: number): Promise<number> {
  const contributed = await prisma.cardPortrait.count({
    where: { contributedBy: userId, contributedSeason: season },
  });
  return contributed * PACKS_PER_CUSTOMIZATION;
}

/**
 * Writes a nickname and/or a picture onto a card the member owns, and pays the
 * reward if the picture gave a faceless card its first face.
 *
 * `undefined` means "leave this alone" and `null` means "clear it", which is
 * what lets one route serve both the nickname form and the upload without
 * either wiping the other.
 *
 * Which table an upload lands in is not the caller's choice — it is decided
 * here, from whether the card has a portrait already:
 *
 *   no portrait anywhere  -> CardPortrait, permanent, pays a pack
 *   already has one       -> CardImage, season-scoped, pays nothing
 *
 * Clearing removes only the override. A contributed portrait is not the
 * uploader's to withdraw: it belongs to the card now, and the member may not
 * even own that card next season.
 *
 * @returns null when the member does not own that card, which the route
 *          answers as a 404 — the same answer a nonexistent card gets, so this
 *          cannot be used to discover what other people hold.
 */
export async function customizeCard(
  userId: string,
  cardId: string,
  season: number,
  week: number,
  changes: { nickname?: string | null; image?: { bytes: Uint8Array; mimeType: string } | null },
): Promise<CustomizationResult | null> {
  const owned = await prisma.cardOwnership.findFirst({
    where:  { userId, gameSeason: season, cardId },
    select: { id: true, nickname: true },
  });
  if (!owned) return null;

  const [definition, portrait, override] = await Promise.all([
    prisma.cardDefinition.findUnique({ where: { id: cardId }, select: { headshot: true } }),
    prisma.cardPortrait.findUnique({ where: { cardId }, select: { id: true } }),
    prisma.cardImage.findUnique({
      where:  { gameSeason_cardId: { gameSeason: season, cardId } },
      select: { id: true },
    }),
  ]);

  const nickname = changes.nickname === undefined ? owned.nickname : changes.nickname;
  if (changes.nickname !== undefined) {
    await prisma.cardOwnership.update({ where: { id: owned.id }, data: { nickname } });
  }

  // Eligible only while the card has no face at all — not the pool's, and not
  // one somebody has already contributed.
  const eligibleForReward = isUnillustrated(definition?.headshot) && !portrait;

  let hasContributed = Boolean(portrait);
  let hasOverride = Boolean(override);
  let packsAwarded = 0;

  if (changes.image === null) {
    // Only the override is the member's to remove. A contributed portrait stays.
    await prisma.cardImage.deleteMany({ where: { gameSeason: season, cardId } });
    hasOverride = false;
  } else if (changes.image) {
    const data = Buffer.from(changes.image.bytes).toString('base64');

    if (eligibleForReward && (await packsEarned(userId, season)) < MAX_CUSTOMIZATION_PACKS) {
      // The unique key on cardId is the idempotence: a second request racing
      // this one fails to insert and pays nothing.
      try {
        await prisma.cardPortrait.create({
          data: {
            cardId,
            contributedBy: userId,
            contributedSeason: season,
            mimeType: changes.image.mimeType,
            data,
          },
        });
        await ensureGrant(userId, season, week);
        packsAwarded = PACKS_PER_CUSTOMIZATION;
        await prisma.packGrant.updateMany({
          where: { userId, gameSeason: season, week },
          data:  { packsGranted: { increment: packsAwarded } },
        });
        hasContributed = true;
      } catch {
        // Lost the race — somebody contributed this card's portrait first. Not
        // an error, and deliberately not paid, so the pack is granted once.
        hasContributed = true;
      }
    } else {
      // Either the card already has a face, or the member is at the cap. Both
      // land as a season-scoped override that earns nothing.
      await prisma.cardImage.upsert({
        where:  { gameSeason_cardId: { gameSeason: season, cardId } },
        create: { userId, gameSeason: season, cardId, mimeType: changes.image.mimeType, data },
        update: { userId, mimeType: changes.image.mimeType, data, uploadedAt: new Date() },
      });
      hasOverride = true;
    }
  }

  const packsEarnedTotal = await packsEarned(userId, season);

  return {
    nickname,
    hasCustomImage: hasOverride || hasContributed,
    // The override wins on screen, so it is what "is this permanent?" is about.
    isContributed: hasContributed && !hasOverride,
    eligibleForReward,
    packsAwarded,
    packsEarnedTotal,
    rewardsRemaining: Math.max(0, MAX_CUSTOMIZATION_PACKS - packsEarnedTotal),
  };
}
