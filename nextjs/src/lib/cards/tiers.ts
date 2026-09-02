// src/lib/cards/tiers.ts
//
// Every tunable number in the card game, and nothing else.
//
// The tier cutoffs, the pack recipes and the drop odds are all things a
// commissioner will want to argue about mid-season, so they live in one file
// that can be read end-to-end rather than being scattered across the builder,
// the opener and the UI. The pool builder, the pack opener, the API routes and
// the card artwork all read their constants from here.

import type { CardTier } from '@prisma/client';

/**
 * Tiers from rarest to most common.
 *
 * Order matters: `TIER_ORDER.indexOf` is how the rest of the module decides
 * what "a lower tier" means, so a tier inserted in the wrong place silently
 * changes every pack recipe.
 */
export const TIER_ORDER: CardTier[] = ['HALL_OF_FAME', 'GOLD', 'SILVER', 'BRONZE'];

/**
 * Fantasy positions that get a card.
 *
 * Kickers and team defenses are deliberately absent. nflverse scores neither —
 * its fantasy columns cover offence only, and it publishes individual defenders
 * rather than a team-defense row — so both had to be scored by hand from the
 * box score. Both hand-rolled formulas turned out to rest on columns the feed
 * leaves empty (fumble recoveries, safeties, blocked kicks, field-goal
 * distances were all zero league-wide), which left kickers on flat make counts
 * and defenses spanning a range of four points a game. Neither made a card
 * worth chasing, so neither is a card.
 */
export const ELIGIBLE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export type EligiblePosition = (typeof ELIGIBLE_POSITIONS)[number];

/**
 * Highest season-finish rank that still earns each tier, walked in TIER_ORDER.
 *
 * Ranks 1–5 are Hall of Fame, 6–10 Gold, 11–30 Silver, and everyone else
 * Bronze. The brief described Silver as "10-20"; taken literally that would put
 * the 10th-place finisher in two tiers at once, so the boundaries are read as
 * half-open and rank 10 stays Gold.
 *
 * **Silver runs to 30, not 20.** These bands are what decide the shape of the
 * pool, and at 20 the three named tiers covered 30 ranks per position while
 * Bronze absorbed everything below — 84% of the pool. That is the real source
 * of "too much Bronze": the pack recipe can only deal what the pool holds.
 *
 * Twenty ranks of Silver doubles it to 2,160 cards and takes Bronze to 76%. It
 * also fixes a supply problem the pack rebalance created: at ten ranks, a
 * twelve-member season consumed about 90% of the Silver pool, and a tier that
 * runs dry is dropped from the roll entirely — which would collapse the game
 * back to Bronze late in the season. At twenty ranks that drain is 45%.
 *
 * The cost is what a Silver card means: the 30th-best receiver of a season
 * rather than the 20th. That is still a starter in a twelve-team league, which
 * is the line worth holding.
 *
 * Changing any of these requires a pool rebuild — tiers are assigned at build
 * time by rebuildCardPool, not derived on read.
 *
 * The rank these cut against is a finish *within a position* for one season —
 * QB1 through QB5 of 2025 are Hall of Fame, and so are K1 through K5. See
 * rankSeason in pool.ts.
 */
export const TIER_MAX_RANK: Record<Exclude<CardTier, 'BRONZE'>, number> = {
  HALL_OF_FAME: 5,
  GOLD: 10,
  SILVER: 30,
};

/** Cards dealt by an ordinary pack, whatever its tier. */
export const CARDS_PER_PACK = 5;

/**
 * A Sleeper bonus pack is an ordinary pack.
 *
 * It used to be ten cards with a Silver floor, and that made it by far the
 * most expensive thing in the game: a floored ten-card pack draws 3.26 Silver
 * against an ordinary pack's 1.43, and Silver is the tier that runs out first.
 * Two bonuses a week at that size out-consumed the entire weekly ration, which
 * put a twelve-member league past a 70% Silver drain before any other reward
 * existed.
 *
 * So the reward is now the pack itself rather than a better pack. Winning still
 * pays — an extra pack is an extra five cards nobody else can have — and the
 * pool lasts. There is no BONUS_PACK_CARDS or BONUS_PACK_TIERS any more:
 * CARDS_PER_PACK and PACK_DROP_WEIGHT cover every pack in the game.
 */

/**
 * Packs a wildcard can fall out of.
 *
 * Silver and better, so the wildcard is a reason to want the good packs rather
 * than a flat trickle. A Bronze pack is already the consolation prize; putting
 * the game's only multiplier in it would make the tier ladder pointless.
 */
export const WILDCARD_PACK_TIERS: CardTier[] = ['HALL_OF_FAME', 'GOLD', 'SILVER'];

/**
 * Chance that a qualifying pack carries a wildcard, per pack.
 *
 * A wildcard takes a card slot rather than adding a sixth, so the cost of this
 * number is real: at 0.15 roughly one Silver-or-better pack in seven trades its
 * weakest card for a die worth one to six more packs. That trade is heavily in
 * the member's favour, which is why the rate is low — it wants to feel like a
 * find, and a member who never sees one has still lost nothing.
 *
 * Tuned here rather than inline for the same reason as every other number in
 * this file: the balance of the game should be readable in one place.
 */
export const WILDCARD_PULL_CHANCE = 0.15;

/**
 * Cards of the pack's own tier that the pack guarantees.
 *
 * The balance of the pack is filled from strictly lower tiers, so a Bronze pack
 * guaranteeing all five is the same rule as the others rather than a special
 * case — there is nothing below Bronze to fill with.
 */
export const PACK_GUARANTEE: Record<CardTier, number> = {
  HALL_OF_FAME: 1,
  GOLD: 2,
  SILVER: 3,
  BRONZE: CARDS_PER_PACK,
};

/**
 * Relative likelihood of each tier when a filler slot is rolled.
 *
 * These are weights, not percentages: a filler slot draws from whichever tiers
 * sit below the pack's tier, and the weights are renormalized over just those.
 * So Silver-vs-Bronze reads the same 40:48 in a Hall of Fame pack as in a Gold
 * pack, and only the tiers on offer change.
 *
 * Silver was 18 against Bronze 75, which made every filler slot in the game
 * four-fifths Bronze. A Gold pack is three filler slots and a Hall of Fame pack
 * is four, so that one ratio was the largest single source of Bronze cards —
 * see PACK_DROP_WEIGHT for the other half of the rebalance.
 *
 * `HALL_OF_FAME` here is never read. Filler draws from `lowerTiers`, which is
 * strictly below the pack's own tier, and nothing sits above Hall of Fame — so
 * it is never a filler candidate in any pack. The key exists only because this
 * is a total Record over CardTier. Changing it has no effect on anything.
 */
export const FILLER_TIER_WEIGHT: Record<CardTier, number> = {
  HALL_OF_FAME: 1,
  GOLD: 10,
  SILVER: 40,
  BRONZE: 48,
};

/**
 * Relative likelihood of each pack type when a pack is rolled.
 *
 * These sum to 100, so they read directly as percentages.
 *
 * **Hall of Fame at 8** is what makes the top tier reachable. At 3, a member
 * opening a full season's 39 packs had a 20% chance of never seeing a single
 * Hall of Fame pack — one member in five finished the year with the top tier as
 * something only other people had. At 8 that miss rate is 4%. It is still the
 * rarest pack by more than a factor of two, and it costs the pool almost
 * nothing: a twelve-member season draws about 7% of the 540 Hall of Fame cards,
 * which were otherwise sitting unclaimed.
 *
 * **Silver at 36 against Bronze at 40** is the other half of the rebalance.
 * Silver was 25 against Bronze 60. A Bronze pack is five Bronze cards and no
 * filler, so every Bronze pack rolled is five guaranteed commons and no chance
 * of anything else — which made the drop weight, not the filler, the first
 * thing to move. Bronze stays the commonest pack, but only just; the ordering
 * is kept strict deliberately, so the tier ladder still reads as a ladder.
 *
 * Balanced against GUARANTEED_GOLD_PACKS being 0. These weights assume every
 * ration pack is genuinely rolled; restoring the Gold pity timer would push
 * Gold back above Silver and undo the point of this table.
 */
export const PACK_DROP_WEIGHT: Record<CardTier, number> = {
  HALL_OF_FAME: 8,
  GOLD: 16,
  SILVER: 36,
  BRONZE: 40,
};

/**
 * What a card of each tier is worth to a deck's score.
 *
 * Ownership is exclusive, so the game is a race for the scarce top of the pool
 * rather than a completion challenge — which means members need a single number
 * to be ranked on, and it has to reward rarity over volume. These weights are
 * roughly the scarcity ratio, compressed: there are about nineteen Bronze cards
 * for every Hall of Fame one, and a Hall of Fame card is worth twenty-five
 * Bronze. Compressing it that way keeps a deep Bronze deck worth something
 * without ever letting it out-score a genuinely rare one.
 *
 * Four Hall of Fame cards beat a hundred Bronze. That is the intended shape.
 */
export const DECK_POINTS: Record<CardTier, number> = {
  HALL_OF_FAME: 100,
  GOLD: 40,
  SILVER: 15,
  BRONZE: 4,
};

/** Display copy for each tier, used by the pack-opening UI and the collection. */
export const TIER_LABEL: Record<CardTier, string> = {
  HALL_OF_FAME: 'Hall of Fame',
  GOLD: 'Gold',
  SILVER: 'Silver',
  BRONZE: 'Bronze',
};

/**
 * Total deck score for a set of owned cards, grouped by tier.
 *
 * Takes counts rather than cards so the leaderboard can score every member from
 * one grouped query instead of loading everybody's collection.
 */
export function deckScore(countsByTier: Partial<Record<CardTier, number>>): number {
  return TIER_ORDER.reduce(
    (total, tier) => total + (countsByTier[tier] ?? 0) * DECK_POINTS[tier],
    0,
  );
}

/**
 * Tier assignment for a season finish.
 *
 * @param rank 1-based finish among eligible players in a single NFL season.
 * @returns The tier that rank earns.
 */
export function tierForRank(rank: number): CardTier {
  if (rank <= TIER_MAX_RANK.HALL_OF_FAME) return 'HALL_OF_FAME';
  if (rank <= TIER_MAX_RANK.GOLD) return 'GOLD';
  if (rank <= TIER_MAX_RANK.SILVER) return 'SILVER';
  return 'BRONZE';
}

/**
 * The tiers a filler slot in a `tier` pack may draw from.
 *
 * Empty for Bronze, which is why a Bronze pack is all guarantee.
 */
export function lowerTiers(tier: CardTier): CardTier[] {
  return TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1);
}
