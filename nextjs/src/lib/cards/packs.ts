// src/lib/cards/packs.ts
//
// Pack opening, as pure functions over a card pool.
//
// Nothing here touches Prisma or the network: a caller loads the pool, calls
// `openPack`, and persists whatever comes back. That split is what makes the
// odds testable — the randomness arrives as an injected `Rng`, so a test can
// pin a seed and assert on exact pulls instead of on distributions.

import type { CardTier } from '@prisma/client';
import {
  CARDS_PER_PACK,
  FILLER_TIER_WEIGHT,
  PACK_DROP_WEIGHT,
  PACK_GUARANTEE,
  TIER_ORDER,
  WILDCARD_PACK_TIERS,
  WILDCARD_PULL_CHANCE,
  lowerTiers,
} from '@/lib/cards/tiers';

/** A source of uniform values in [0, 1). `Math.random` satisfies this. */
export type Rng = () => number;

/** The fields pack logic needs from a card. The DB row is a superset. */
export interface PoolCard {
  id: string;
  tier: CardTier;
}

/** Cards available to draw, bucketed by tier. */
export type CardPool = Record<CardTier, PoolCard[]>;

/** An opened pack: the tier that was rolled, and the cards in reveal order. */
export interface OpenedPack {
  packTier: CardTier;
  cards: PoolCard[];
}

/**
 * Deterministic RNG for tests and for replaying a recorded opening.
 *
 * A 32-bit xorshift — not cryptographically anything, and not meant to be. It
 * exists so that "seed 42 pulls these five cards" is a stable fact.
 */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9;

  const step = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };

  // Discard the first few outputs. Xorshift mixes poorly for the first step or
  // two from a small seed, so `makeRng(1)`, `makeRng(2)`, `makeRng(3)` … all
  // open with values close enough together to land in the same bucket. That is
  // invisible in production, where the RNG is Math.random and runs as one long
  // stream, but it silently ruins any test that samples a distribution by
  // reseeding in a loop — which is exactly how the bonus-tier odds are checked.
  for (let i = 0; i < 8; i++) step();

  return step;
}

/**
 * Picks one key from `weights` in proportion to its weight.
 *
 * Keys weighted zero (or absent) are never returned. Returns null when every
 * candidate weighs zero, which callers treat as "this pool is empty".
 */
export function weightedPick<K extends string>(
  weights: Partial<Record<K, number>>,
  rng: Rng,
): K | null {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;

  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) return key;
  }
  // Only reachable through floating-point drift on the final entry.
  return entries[entries.length - 1][0];
}

/**
 * Rolls which kind of pack a member is about to open.
 *
 * Tiers with no cards in the pool are excluded rather than rolled and then
 * substituted — an empty Hall of Fame bucket should not eat a member's pack and
 * hand back a Bronze one that looks like a bug.
 */
export function rollPackTier(pool: CardPool, rng: Rng): CardTier | null {
  const weights: Partial<Record<CardTier, number>> = {};
  for (const tier of TIER_ORDER) {
    if (pool[tier]?.length) weights[tier] = PACK_DROP_WEIGHT[tier];
  }
  return weightedPick(weights, rng);
}

/**
 * Draws one card of `tier`, skipping ids already dealt into this pack.
 *
 * A pack should not hand back the same card twice, but the constraint is a
 * preference rather than a guarantee: when a tier holds fewer distinct cards
 * than the pack needs — a five-card Bronze pack against a three-card pool, as
 * happens before older seasons are backfilled — it repeats rather than dealing
 * short.
 */
function drawFromTier(cards: PoolCard[], used: Set<string>, rng: Rng): PoolCard | null {
  if (!cards.length) return null;
  const fresh = cards.filter((c) => !used.has(c.id));
  const candidates = fresh.length ? fresh : cards;
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

/**
 * Opens one pack of the given tier.
 *
 * The pack is `PACK_GUARANTEE[tier]` cards of its own tier, then filler drawn
 * from strictly lower tiers in `FILLER_TIER_WEIGHT` proportion. A Bronze pack
 * is all guarantee and no filler, since nothing sits below it.
 *
 * Every pack is CARDS_PER_PACK cards. There used to be a `size` parameter, for
 * a ten-card Sleeper bonus pack; that pack is an ordinary pack now, and a knob
 * with one setting is worse than no knob.
 *
 * Filler falls back to the guaranteed tier only if every lower tier is empty,
 * which keeps a pack full while the pool is still thin.
 *
 * @returns The cards in reveal order — guaranteed tier first, so the UI can
 *          hold the best card back by reversing it.
 */
export function openPack(tier: CardTier, pool: CardPool, rng: Rng): PoolCard[] {
  const size = CARDS_PER_PACK;
  const cards: PoolCard[] = [];
  const used = new Set<string>();

  const take = (from: CardTier): boolean => {
    const card = drawFromTier(pool[from] ?? [], used, rng);
    if (!card) return false;
    cards.push(card);
    used.add(card.id);
    return true;
  };

  for (let i = 0; i < PACK_GUARANTEE[tier] && cards.length < size; i++) {
    take(tier);
  }

  const below = lowerTiers(tier).filter((t) => pool[t]?.length);
  while (cards.length < size) {
    const weights: Partial<Record<CardTier, number>> = {};
    for (const t of below) weights[t] = FILLER_TIER_WEIGHT[t];

    const fillTier = weightedPick(weights, rng);
    // No lower tier has cards — top the pack up from its own tier instead.
    if (!take(fillTier ?? tier)) break;
  }

  return cards;
}

/**
 * Rolls a pack type and opens it.
 *
 * @returns null when the pool holds no cards at all, which means the pool has
 *          not been built yet.
 */
export function rollAndOpen(pool: CardPool, rng: Rng = Math.random): OpenedPack | null {
  const packTier = rollPackTier(pool, rng);
  if (!packTier) return null;
  return { packTier, cards: openPack(packTier, pool, rng) };
}

/**
 * Whether this pack carries a wildcard.
 *
 * Silver and better only — see WILDCARD_PACK_TIERS. Split out from the drawing
 * so the decision can be pinned in a test without pinning the cards too.
 */
export function rollsWildcard(tier: CardTier, rng: Rng): boolean {
  if (!WILDCARD_PACK_TIERS.includes(tier)) return false;
  return rng() < WILDCARD_PULL_CHANCE;
}

/**
 * Which card a wildcard displaces: the weakest in the pack.
 *
 * A wildcard takes a slot rather than adding one, and taking the slot at random
 * would sometimes eat the guaranteed Hall of Fame card the pack was opened for
 * — turning the best possible pull into a consolation die. So it always
 * displaces the lowest tier present, and among equals the last one drawn, which
 * under `openPack`'s guarantee-then-filler order is the most disposable filler.
 *
 * @returns An index into `cards`, or -1 for an empty pack.
 */
export function weakestCardIndex(cards: PoolCard[]): number {
  let worst = -1;
  let worstRank = -1;

  cards.forEach((card, i) => {
    // TIER_ORDER runs rarest first, so a higher index is a worse card.
    const rank = TIER_ORDER.indexOf(card.tier);
    if (rank >= worstRank) {
      worstRank = rank;
      worst = i;
    }
  });

  return worst;
}

/** Groups a flat list of cards into the bucketed shape `openPack` expects. */
export function toPool(cards: PoolCard[]): CardPool {
  const pool = { HALL_OF_FAME: [], GOLD: [], SILVER: [], BRONZE: [] } as CardPool;
  for (const card of cards) pool[card.tier]?.push(card);
  return pool;
}
