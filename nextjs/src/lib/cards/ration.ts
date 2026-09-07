// src/lib/cards/ration.ts
//
// How many packs a member gets, from every supply — and nothing that touches a
// database.
//
// These numbers used to live in allowance.ts and bonus.ts, beside the queries
// that spend them. That put them out of reach of anything rendered on the
// client: both of those modules import Prisma, and importing Prisma into a
// client component is a build error. So the Draft Deck tour, which exists to
// state exactly these numbers, had to type them out in prose instead — and
// prose does not get recompiled when a constant changes. It drifted, which is
// what issue #43 is about: the tour promised a Gold pack a week for months
// after GUARANTEED_GOLD_PACKS went to zero.
//
// Pulling the constants into a Prisma-free module fixes that at the root. The
// tour imports from here, so a commissioner retuning the ration cannot leave
// the explanation lying — the same rule tiers.ts already held for the pack
// odds.
//
// allowance.ts and bonus.ts re-export everything below, so every existing
// import of them keeps working and there is one obvious place to look.

/** The two ways to earn a bonus pack from a Sleeper result. */
export const BONUS_KINDS = ['WIN', 'HIGH_SCORE'] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];

/** The weekly ration, before the wildcard. Paid from FIRST_RATION_WEEK on. */
export const PACKS_PER_WEEK = 2;

/**
 * The first week that pays a ration.
 *
 * Week 1 is the starter grant's week and pays nothing on top of it. Stated as a
 * week number rather than a boolean because the game's weeks are the NFL's, and
 * a member who joins in week 6 gets week 6's ration — this delays the ration by
 * a week of the season, not by a week of the member's membership.
 */
export const FIRST_RATION_WEEK = 2;

/**
 * Ration packs each week guaranteed to be Gold or better. Now none.
 *
 * Delivered by a pity timer rather than by dealing the week's packs up front —
 * see mustForceGold in service.ts. At a quota of zero the timer is inert:
 * mustForceGold returns false on a zero quota before it reads anything, so
 * every ration pack is genuinely rolled.
 *
 * **This was 1, and at a two-pack ration it inverted the rarity ladder.**
 *
 * The timer forces a pack whenever the supply can no longer reach its quota.
 * With two packs and a quota of one, the first pack is a free roll and the
 * second is forced unless the first already landed Gold or better — which it
 * did 15% of the time. So 85% of second ration packs were forced to Gold,
 * roughly half of every pack in the game became a Gold pack, and Gold cards
 * (19% of everything dealt) ended up commoner than Silver ones (15%). Silver is
 * the tier below Gold and was arriving less often than the tier above it.
 *
 * The guarantee was sound at the old five-pack ration, where it was a 20%
 * floor. At two packs it is a 50% floor, which is not a floor but a redesign.
 * The ration is small enough now that a member notices every pack, so the
 * honest fix is to let all of them roll and widen the Silver band instead —
 * see PACK_DROP_WEIGHT in tiers.ts, which is balanced against this being 0.
 *
 * The starter grant keeps its own quota. Five packs at a quota of two is still
 * a real floor rather than a majority, and a new member's first handful is the
 * one place a guarantee earns its distortion — see STARTER_GUARANTEED_GOLD.
 *
 * Annotated `number` rather than left to infer the literal `0`. The Draft Deck
 * tour describes the ration one way when there is a guarantee and another way
 * when there is not, and against a literal type TypeScript calls the branch it
 * cannot currently reach an error — which would mean restoring the guarantee
 * broke the build of the page that explains it. A tunable that cannot be tuned
 * without a compiler error is not a tunable.
 */
export const GUARANTEED_GOLD_PACKS: number = 0;

/**
 * The welcome grant: packs a member gets once, the first time they open the
 * game, and the number of those guaranteed Gold or better.
 *
 * Separate from the weekly ration in every sense — its own grant row, its own
 * counters, and its own Gold quota. A new member opening five packs of mostly
 * Bronze has nothing to field and no reason to come back; two guaranteed Golds
 * is enough to start a lineup with.
 *
 * Once, on first open — not in week 1. A member who joins in week 6 gets this
 * grant and week 6's ration, which is why the tour states it as a first-sitting
 * handful rather than as week 1's allowance.
 *
 * Each supply's Gold promise counts only its own packs. A starter Gold does not
 * satisfy the week's guarantee, and neither does a Sleeper bonus — otherwise a
 * member's first week would quietly be worse than their second.
 */
export const STARTER_PACKS = 5;
export const STARTER_GUARANTEED_GOLD = 2;

/** Faces on the wildcard die — and so the most extra packs it can grant. */
export const WILDCARD_SIDES = 6;

/** Points a member must beat in a single league to earn the high-score pack. */
export const HIGH_SCORE_THRESHOLD = 100;

/**
 * Weeks in the fantasy regular season.
 *
 * Not used to size the ration any more; kept because the season-depth maths in
 * the docs and the pool warnings are stated in terms of it.
 */
export const SEASON_WEEKS = 18;

/**
 * The ration for one week: nothing in week 1, PACKS_PER_WEEK from week 2 on.
 *
 * The whole of the week-1 rule lives here, so every caller that sizes or
 * reports a grant goes through one function rather than each repeating the
 * comparison.
 */
export function packsForWeek(week: number): number {
  return week < FIRST_RATION_WEEK ? 0 : PACKS_PER_WEEK;
}

/**
 * Rolls the wildcard die.
 *
 * Injectable RNG for the same reason the pack odds take one: a die that cannot
 * be pinned in a test is a die nobody can check.
 */
export function rollWildcard(rng: () => number = Math.random): number {
  return 1 + Math.floor(rng() * WILDCARD_SIDES);
}
