// src/lib/cards/allowance.ts
//
// How many packs a member gets each week, and what "this week" means.
//
// A flat ration plus a die. Two packs land every week, and a wildcard pulled
// from a Silver-or-better pack — at WILDCARD_PULL_CHANCE, not every week —
// carries a roll of a six-sided die worth one to six more. So the floor is
// predictable and the ceiling is not.
//
// Week 1 is the exception: it has no ration at all. A member's first week is
// the five-pack starter grant and nothing else, so opening the game for the
// first time is one clean handful rather than ten packs at once. The ration
// starts with week 2 — see packsForWeek.
//
// On top of that sit two supplies that are not weekly: a one-off starter grant
// the first time a member opens the game, and Sleeper bonus packs earned from
// results. Each is counted separately, because each carries its own promise
// about how many of its packs are Gold.
//
// This replaced a formula that derived the ration from the size of the pool and
// the number of players. The formula was defensible and nobody could tell you
// what they were going to get. A number you can say out loud beats one you have
// to compute.
//
// Pool depth still matters, because ownership is exclusive: at two packs a week
// plus the starter grant and the wildcards they pull, a single member claims
// roughly 250 cards over a season against a pool of 1,613. See docs/CARDS.md —
// a twelve-team league still wants the 1999+ backfill behind it.

import { prisma } from '@/lib/prisma';
import { eligiblePlayerWhere } from '@/lib/cards/eligibility';

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
 */
export const GUARANTEED_GOLD_PACKS = 0;

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
 * The welcome grant: packs a member gets once, the first time they open the
 * game, and the number of those guaranteed Gold or better.
 *
 * Separate from the weekly ration in every sense — its own grant row, its own
 * counters, and its own Gold quota. A new member opening five packs of mostly
 * Bronze has nothing to field and no reason to come back; two guaranteed Golds
 * is enough to start a lineup with.
 *
 * Each supply's Gold promise counts only its own packs. A starter Gold does not
 * satisfy the week's guarantee, and neither does a Sleeper bonus — otherwise a
 * member's first week would quietly be worse than their second.
 */
export const STARTER_PACKS = 5;
export const STARTER_GUARANTEED_GOLD = 2;

/** Faces on the wildcard die — and so the most extra packs it can grant. */
export const WILDCARD_SIDES = 6;

/**
 * Weeks in the fantasy regular season.
 *
 * Not used to size the ration any more; kept because the season-depth maths in
 * the docs and the pool warnings are stated in terms of it.
 */
export const SEASON_WEEKS = 18;

/**
 * The game season, which tracks the NFL season the rest of the app runs on.
 *
 * Everything a member owns is scoped to this, so the rollover to a new season
 * is what "the game resets" means: the new season starts with an empty deck and
 * a fresh ration, and last season's rows stay on disk until a commissioner
 * clears them.
 */
export function gameSeason(): number {
  return parseInt(process.env.NFL_SEASON || String(new Date().getFullYear()), 10);
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

/**
 * The state of the pool everyone is drawing from.
 *
 * `remainingCards` is the number that actually matters day to day — cards are
 * owned exclusively, so the pool size is trivia once most of it is spoken for,
 * and an empty pool is what stops packs being openable.
 */
export async function currentAllowance(): Promise<{
  poolSize: number; claimed: number; remainingCards: number;
  members: number; perWeek: number;
}> {
  const season = gameSeason();
  const [poolSize, claimed, members] = await Promise.all([
    prisma.cardDefinition.count(),
    prisma.cardOwnership.count({ where: { gameSeason: season } }),
    playerCount(),
  ]);

  return {
    poolSize,
    claimed,
    remainingCards: Math.max(0, poolSize - claimed),
    members,
    perWeek: PACKS_PER_WEEK,
  };
}

/**
 * How many people are sharing the pool.
 *
 * Reported to the UI rather than used to size the ration — with exclusive
 * ownership a league wants to see how many ways the pool is being split even
 * though the ration no longer depends on it.
 */
export async function playerCount(): Promise<number> {
  return Math.max(1, await prisma.user.count({ where: eligiblePlayerWhere() }));
}

/**
 * Finds or creates a member's grant row for one week.
 *
 * Created lazily on first read rather than by a scheduled job, so a member who
 * skips three weeks and comes back gets this week's packs and not a backlog —
 * the ration is a weekly allowance, not a balance that accrues.
 *
 * A week-1 row is still created, at zero packs. It has to be: it is where the
 * pre-rolled tier and any Sleeper bonus or wildcard payout for week 1 are
 * written, and those are all live in week 1 even though the ration is not.
 */
export async function ensureGrant(userId: string, season: number, week: number) {
  const existing = await prisma.packGrant.findUnique({
    where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
  });
  if (existing) return existing;

  // upsert rather than create: two tabs opening the page at once would
  // otherwise race on the unique index and 500 one of them.
  return prisma.packGrant.upsert({
    where:  { userId_gameSeason_week: { userId, gameSeason: season, week } },
    create: { userId, gameSeason: season, week, packsGranted: packsForWeek(week) },
    update: {},
  });
}

/**
 * Finds or creates a member's one-off starter grant.
 *
 * Created on first read rather than at sign-up: there is no hook on account
 * creation, and "the first time they open the game" is the moment that actually
 * matters. `upsert` keyed on (userId, gameSeason) is what makes it once — two
 * tabs loading the page together cannot both grant it.
 */
export async function ensureStarterGrant(userId: string, season: number) {
  return prisma.starterGrant.upsert({
    where:  { userId_gameSeason: { userId, gameSeason: season } },
    create: { userId, gameSeason: season, packsGranted: STARTER_PACKS },
    update: {},
  });
}

/**
 * Throws one wildcard and adds the result to the member's ration.
 *
 * The conditional update is the whole point: `rolledValue: null` in the `where`
 * means a second request — a double-click, a retried fetch — matches nothing
 * and changes nothing, so a die cannot be thrown twice. The caller
 * distinguishes "already rolled" from "just rolled" by the returned count
 * rather than by reading first, which would leave a window between the check
 * and the write.
 *
 * `userId` is in the `where` too, so this doubles as the ownership check: a
 * member throwing somebody else's die matches nothing and is reported as a
 * miss, which is also what a nonexistent id gets. Both are refusals, and
 * telling them apart would only confirm that an id exists.
 *
 * The packs land on the *current* week's grant rather than the week the
 * wildcard was pulled in. A die found in week 3 and thrown in week 5 pays out
 * in week 5, because packs a member can no longer reach are not a prize.
 */
export async function claimWildcard(
  userId: string, id: string, season: number, week: number, rng?: () => number,
): Promise<{ rolled: boolean; value: number; packsGranted: number } | null> {
  await ensureGrant(userId, season, week);

  const value = rollWildcard(rng);

  const updated = await prisma.wildcardCard.updateMany({
    where: { id, userId, gameSeason: season, rolledValue: null },
    data:  { rolledValue: value, rolledAt: new Date() },
  });

  // Only credit the ration once the die is provably ours to throw. Doing it the
  // other way round would hand out packs for an id that matched nothing.
  if (updated.count === 1) {
    await prisma.packGrant.updateMany({
      where: { userId, gameSeason: season, week },
      data:  { packsGranted: { increment: value } },
    });
  }

  const [card, grant] = await Promise.all([
    prisma.wildcardCard.findFirst({
      where:  { id, userId, gameSeason: season },
      select: { rolledValue: true },
    }),
    prisma.packGrant.findUnique({
      where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
    }),
  ]);

  // Not ours, or not a wildcard at all. Null rather than a zero roll so the
  // route can answer 404 instead of pretending a die was thrown.
  if (!card) return null;

  return {
    rolled: updated.count === 1,
    // On a lost race, report the roll that actually stuck.
    value: updated.count === 1 ? value : (card.rolledValue ?? value),
    packsGranted: grant?.packsGranted ?? packsForWeek(week),
  };
}

/** Wildcards a member is holding but has not thrown, oldest first. */
export async function pendingWildcards(
  userId: string, season: number,
): Promise<{ id: string; week: number }[]> {
  return prisma.wildcardCard.findMany({
    where:   { userId, gameSeason: season, rolledValue: null },
    select:  { id: true, week: true },
    orderBy: { pulledAt: 'asc' },
  });
}
