// src/lib/cards/service.ts
//
// The database side of the card game: reading a member's deck, ranking the
// league, and the write that turns one of their packs into cards they own.
//
// packs.ts holds the odds and knows nothing about Prisma; this module holds the
// persistence and knows nothing about the odds. The two meet in `openOnePack`.
//
// The thing that makes this file more than plumbing is exclusivity. A card has
// one owner for the season, so dealing a pack is not "write down what they got"
// — it is a claim that can lose a race, and losing it has to be handled without
// either duplicating a card or silently dealing a short pack.

import { prisma } from '@/lib/prisma';
import { Prisma, type CardTier } from '@prisma/client';
import { RouteCache } from '@/lib/cache';
import { eligiblePlayerWhere } from '@/lib/cards/eligibility';
import { isUnillustrated } from '@/lib/cards/customize';
import {
  CARDS_PER_PACK, TIER_ORDER, lowerTiers,
} from '@/lib/cards/tiers';
import {
  ROSTER_SLOT_IDS, deckAveragePointsPerGame, layoutRoster, rosterPointsPerGame,
  slotAccepts, type FilledSlot, type RosterScorable,
} from '@/lib/cards/roster';
import {
  openPack, rollPackTier, rollsWildcard, toPool, weakestCardIndex,
  type CardPool, type PoolCard, type Rng,
} from '@/lib/cards/packs';
import {
  FIRST_RATION_WEEK, GUARANTEED_GOLD_PACKS, STARTER_GUARANTEED_GOLD,
  currentAllowance, ensureGrant, ensureStarterGrant, gameSeason, pendingWildcards,
} from '@/lib/cards/allowance';
import type {
  AllowanceDto, CardDto, DeckStatsDto, LeaderboardEntryDto, OwnedCardDto,
  PendingWildcardDto,
} from '@/types/cards';

/** Columns the client needs. Keeps `builtAt` off the wire. */
const CARD_FIELDS = {
  id: true, season: true, playerId: true, playerName: true, position: true,
  team: true, tier: true, seasonRank: true, fantasyPoints: true,
  pointsPerGame: true, gamesPlayed: true, jerseyNumber: true, headshot: true,
} as const;

/** Prisma's error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Whether an error is "someone already owns that card".
 *
 * Two shapes, because the libSQL driver adapter does not reliably translate a
 * SQLite constraint failure into Prisma's P2002. Under the adapter this arrives
 * as a PrismaClientUnknownRequestError carrying the raw SQLite text, so
 * matching the code alone lets a genuine race escape as a 500 — which is what
 * happened the first time two members opened packs at the same moment.
 *
 * The message match is deliberately narrow: only the uniqueness failure counts,
 * so a foreign-key or NOT NULL error still propagates as the bug it is.
 */
function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === UNIQUE_VIOLATION;
  }
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/** How many times a pack will redraw around cards claimed out from under it. */
const MAX_CLAIM_ROUNDS = 4;

/**
 * Every card in the pool, cached in-process.
 *
 * This is the *whole* pool, not the available one — it only changes when a
 * commissioner rebuilds, so it is cached for an hour and dropped explicitly on
 * rebuild. What is still unclaimed changes on every pack anywhere in the
 * league, so that is subtracted per request from a much smaller query.
 */
const poolCache = new RouteCache<PoolCard[]>();
const POOL_TTL_MS = 60 * 60 * 1000;
const POOL_KEY = 'card-pool';

/** Drops the cached pool. Call after a rebuild. */
export function invalidatePoolCache(): void {
  poolCache.clear(POOL_KEY);
}

async function loadAllCards(): Promise<PoolCard[]> {
  const cached = poolCache.get(POOL_KEY, POOL_TTL_MS);
  if (cached) return cached;

  const cards = await prisma.cardDefinition.findMany({ select: { id: true, tier: true } });
  poolCache.set(POOL_KEY, cards);
  return cards;
}

/** The ids already spoken for this season. */
async function claimedIds(season: number): Promise<Set<string>> {
  const rows = await prisma.cardOwnership.findMany({
    where: { gameSeason: season },
    select: { cardId: true },
  });
  return new Set(rows.map((r) => r.cardId));
}

/**
 * The cards a pack may actually deal: everything nobody owns yet.
 *
 * @param exclude Ids to leave out on top of the claimed set — used when
 *                redrawing, so a replacement is not one of the cards this same
 *                pack has already taken.
 */
async function loadAvailablePool(season: number, exclude?: Set<string>): Promise<CardPool> {
  const [all, claimed] = await Promise.all([loadAllCards(), claimedIds(season)]);
  return toPool(
    all.filter((c) => !claimed.has(c.id) && !exclude?.has(c.id)),
  );
}

/**
 * Decides — once — what the member's next pack will be, and stores it.
 *
 * The sealed pack shows its tier before it is torn, which means the tier has to
 * exist before the pack is opened. It cannot be rolled at render time: a tier
 * decided on render would change on every reload, and a member would refresh
 * until a Hall of Fame pack turned up. So it is rolled once and written down.
 *
 * The write is conditional on `nextPackTier: null`, so two tabs loading the
 * page together settle on one tier rather than each rolling their own.
 *
 * Returns null only when the pool is empty, which is the one case where there
 * is genuinely no next pack.
 */
export async function ensureNextPackTier(
  userId: string, season: number, week: number, rng?: Rng,
): Promise<CardTier | null> {
  const [grant, starter] = await Promise.all([
    ensureGrant(userId, season, week),
    ensureStarterGrant(userId, season),
  ]);
  if (grant.nextPackTier) return grant.nextPackTier;

  const pool = await loadAvailablePool(season);
  const { kind, remaining } = nextSupply(grant, starter);

  // A bonus pack is an ordinary pack now, so it needs no branch of its own —
  // it rolls on PACK_DROP_WEIGHT like everything else, Bronze included.

  // The supply's Gold guarantee applies to the pre-roll too, otherwise a pack
  // owed by the guarantee could be shown as Bronze and then silently overridden
  // on open. `remaining - 1` is what is left *after* this one.
  const forceGold =
    pool.GOLD.length > 0 &&
    (await mustForceGold(
      userId, season, kind,
      kind === 'STARTER' ? null : week,
      Math.max(0, remaining - 1),
    ));

  const tier = forceGold ? 'GOLD' : rollPackTier(pool, rng ?? Math.random);
  if (!tier) return null;

  return storeNextTier(userId, season, week, tier);
}

/**
 * Which supply the next pack comes out of, and how many it has left.
 *
 * Starters first, then bonuses, then the weekly ration — see PackKind. Falls
 * through to RATION with zero remaining when everything is spent, which the
 * caller reads as "no packs left".
 */
function nextSupply(
  grant: { packsGranted: number; packsOpened: number; bonusGranted: number; bonusOpened: number },
  starter: { packsGranted: number; packsOpened: number },
): { kind: PackKind; remaining: number } {
  if (hasStarterWaiting(starter)) {
    return { kind: 'STARTER', remaining: starter.packsGranted - starter.packsOpened };
  }
  if (hasBonusWaiting(grant)) {
    return { kind: 'BONUS', remaining: grant.bonusGranted - grant.bonusOpened };
  }
  return { kind: 'RATION', remaining: Math.max(0, grant.packsGranted - grant.packsOpened) };
}

/**
 * Where a pack came from.
 *
 * Opened in this order — starter, then bonus, then ration. Starters come first
 * because they are the onboarding and a new member should meet the good stuff
 * immediately; bonuses come before the ration because a pack won from a Sleeper
 * result should not sit behind five ordinary ones.
 */
export type PackKind = 'STARTER' | 'BONUS' | 'RATION';

/** True when the member still has a bonus pack to open this week. */
function hasBonusWaiting(grant: { bonusGranted: number; bonusOpened: number }): boolean {
  return grant.bonusGranted > grant.bonusOpened;
}

/** True when the member has starter packs left. */
function hasStarterWaiting(grant: { packsGranted: number; packsOpened: number }): boolean {
  return grant.packsGranted > grant.packsOpened;
}

/**
 * How many Gold-or-better packs a supply still owes, and how many chances it
 * has left to deliver them.
 *
 * Only STARTER carries a quota now. A bonus pack is an ordinary pack and makes
 * no promise of its own, and RATION's quota is 0 — at a two-pack ration a
 * one-pack Gold guarantee forced 85% of second packs and made Gold cards
 * commoner than Silver. See GUARANTEED_GOLD_PACKS in allowance.ts.
 */
const GOLD_QUOTA: Record<PackKind, number> = {
  STARTER: STARTER_GUARANTEED_GOLD,
  RATION:  GUARANTEED_GOLD_PACKS,
  BONUS:   0,
};

/**
 * Writes the pre-rolled tier, conditional on nothing having been written yet.
 *
 * Re-reads rather than trusting the local roll: on a lost race the stored tier
 * is another tab's, and that is the one the member was actually shown.
 */
async function storeNextTier(
  userId: string, season: number, week: number, tier: CardTier,
): Promise<CardTier> {
  await prisma.packGrant.updateMany({
    where: { userId, gameSeason: season, week, nextPackTier: null },
    data:  { nextPackTier: tier },
  });

  const settled = await prisma.packGrant.findUnique({
    where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
  });
  return settled?.nextPackTier ?? tier;
}

/** Shapes a grant row plus the supply numbers into the client's allowance view. */
function toAllowanceDto(
  grant: {
    gameSeason: number; week: number;
    packsGranted: number; packsOpened: number;
    nextPackTier?: CardTier | null;
    bonusGranted?: number; bonusOpened?: number;
  },
  pool: Awaited<ReturnType<typeof currentAllowance>>,
  starter?: { packsGranted: number; packsOpened: number } | null,
  wildcards: PendingWildcardDto[] = [],
): AllowanceDto {
  const bonusLeft = Math.max(0, (grant.bonusGranted ?? 0) - (grant.bonusOpened ?? 0));
  const starterLeft = Math.max(0, (starter?.packsGranted ?? 0) - (starter?.packsOpened ?? 0));
  return {
    gameSeason: grant.gameSeason,
    week:       grant.week,
    granted:    grant.packsGranted,
    opened:     grant.packsOpened,
    // Everything openable right now, from all three supplies — a "0 packs left"
    // message beside an unopened starter or bonus pack would be a lie.
    remaining:
      Math.max(0, grant.packsGranted - grant.packsOpened) + bonusLeft + starterLeft,
    poolSize:       pool.poolSize,
    claimed:        pool.claimed,
    remainingCards: pool.remainingCards,
    members:        pool.members,
    perWeek:        pool.perWeek,
    rationStartsWeek: FIRST_RATION_WEEK,
    pendingWildcards: wildcards,
    nextPackTier:   grant.nextPackTier ?? null,
    bonusRemaining: bonusLeft,
    starterRemaining: starterLeft,
    nextPackKind: starterLeft > 0 ? 'STARTER' : bonusLeft > 0 ? 'BONUS' : 'RATION',
    nextPackIsBonus: bonusLeft > 0 && starterLeft === 0,
  };
}

/** This week's ration for one member, creating the grant row if needed. */
export async function readAllowance(
  userId: string, season: number, week: number,
): Promise<AllowanceDto> {
  // Pre-rolls the next pack if it has not been rolled yet, so the page always
  // has a tier to print on the sealed pack.
  await ensureNextPackTier(userId, season, week);

  const [grant, pool, starter, wildcards] = await Promise.all([
    prisma.packGrant.findUnique({
      where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
    }),
    currentAllowance(),
    ensureStarterGrant(userId, season),
    // Every unthrown die, not just this week's: a wildcard found in week 3 and
    // forgotten is still owed, and hiding it would quietly void it.
    pendingWildcards(userId, season),
  ]);

  return toAllowanceDto(
    grant ?? { gameSeason: season, week, packsGranted: 0, packsOpened: 0 },
    pool,
    starter,
    wildcards,
  );
}

/**
 * Counts a member's cards by tier, from one grouped query.
 *
 * Used for both the deck header and the leaderboard, which is why it counts
 * rather than loading cards: ranking twelve members should not mean loading
 * twelve decks.
 */
async function tierCounts(season: number): Promise<Map<string, Record<CardTier, number>>> {
  // CardOwnership has no tier of its own — it is on the card — so this is the
  // one place the two tables have to be joined.
  const rows = await prisma.$queryRaw<{ userId: string; tier: CardTier; n: number }[]>`
    SELECT o.userId AS userId, c.tier AS tier, COUNT(*) AS n
      FROM CardOwnership o
      JOIN CardDefinition c ON c.id = o.cardId
     WHERE o.gameSeason = ${season}
     GROUP BY o.userId, c.tier
  `;

  const byUser = new Map<string, Record<CardTier, number>>();
  for (const row of rows) {
    const counts =
      byUser.get(row.userId) ??
      ({ HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 } as Record<CardTier, number>);
    counts[row.tier] = Number(row.n);
    byUser.set(row.userId, counts);
  }
  return byUser;
}

/**
 * Points per game for every member's lineup, and for their whole deck, in two
 * queries rather than one pair per member.
 *
 * Ranking a twelve-person league should not mean twelve round trips, so both
 * numbers are aggregated in SQL and joined up in memory.
 */
async function scoresByUser(season: number): Promise<
  Map<string, { rosterPpg: number; deckAvgPpg: number; started: number }>
> {
  const [rosters, decks] = await Promise.all([
    // Only slots whose card still exists count — a card removed by a rebuild
    // leaves an empty seat rather than a phantom score.
    prisma.$queryRaw<{ userId: string; total: number; started: number }[]>`
      SELECT r.userId AS userId,
             SUM(c.pointsPerGame) AS total,
             COUNT(*) AS started
        FROM RosterSlot r
        JOIN CardDefinition c ON c.id = r.cardId
       WHERE r.gameSeason = ${season}
       GROUP BY r.userId
    `,
    prisma.$queryRaw<{ userId: string; avg: number }[]>`
      SELECT o.userId AS userId, AVG(c.pointsPerGame) AS avg
        FROM CardOwnership o
        JOIN CardDefinition c ON c.id = o.cardId
       WHERE o.gameSeason = ${season}
       GROUP BY o.userId
    `,
  ]);

  const out = new Map<string, { rosterPpg: number; deckAvgPpg: number; started: number }>();
  const seat = (id: string) =>
    out.get(id) ?? { rosterPpg: 0, deckAvgPpg: 0, started: 0 };

  for (const r of rosters) {
    out.set(r.userId, {
      ...seat(r.userId),
      rosterPpg: Math.round(Number(r.total ?? 0) * 10) / 10,
      started:   Number(r.started ?? 0),
    });
  }
  for (const d of decks) {
    out.set(d.userId, {
      ...seat(d.userId),
      deckAvgPpg: Math.round(Number(d.avg ?? 0) * 10) / 10,
    });
  }
  return out;
}

/**
 * The season standings, ranked by what a member's lineup scores per game.
 *
 * The roster rather than the deck, deliberately: owning a second elite kicker
 * is worth nothing when a better one already holds the slot, so the game is
 * about which ten you field rather than how many you hoard. Deck average is
 * carried alongside as the answer to the other question — how good is
 * everything you pulled — and breaks ties.
 *
 * Members who have not opened anything are included on zero rather than hidden,
 * so a league of eight always shows eight rows and nobody wonders whether they
 * are in the game.
 *
 * Who counts as a member is not decided here — eligiblePlayerWhere() defers to
 * whoever the members page lists, which excludes the seeded superuser. Ranking
 * every User row put a house account nobody plays as at the top of the table.
 */
export async function readLeaderboard(
  season: number, viewerId?: string,
): Promise<LeaderboardEntryDto[]> {
  const [users, counts, scores] = await Promise.all([
    prisma.user.findMany({
      where: eligiblePlayerWhere(),
      select: { id: true, name: true, username: true },
    }),
    tierCounts(season),
    scoresByUser(season),
  ]);

  const empty = { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 } as Record<CardTier, number>;

  return users
    .map((user) => {
      const byTier = counts.get(user.id) ?? empty;
      const score = scores.get(user.id) ?? { rosterPpg: 0, deckAvgPpg: 0, started: 0 };
      return {
        userId: user.id,
        name:   user.name?.trim() || user.username,
        byTier,
        cards:  TIER_ORDER.reduce((n, t) => n + byTier[t], 0),
        rosterPpg:  score.rosterPpg,
        deckAvgPpg: score.deckAvgPpg,
        started:    score.started,
        isYou:      user.id === viewerId,
      };
    })
    .sort(
      (a, b) =>
        b.rosterPpg - a.rosterPpg ||
        b.deckAvgPpg - a.deckAvgPpg ||
        b.byTier.HALL_OF_FAME - a.byTier.HALL_OF_FAME ||
        a.name.localeCompare(b.name),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * A member's deck this season, rarest first.
 *
 * Ownership rows carry only a card id, so the cards are fetched separately and
 * joined here. A row whose card a rebuild removed is dropped rather than
 * rendered as a blank — see the no-foreign-key note in the schema.
 */
export async function readDeck(
  userId: string, season: number,
): Promise<{
  cards: OwnedCardDto[];
  stats: DeckStatsDto;
  roster: FilledSlot[];
  /**
   * The standings, returned rather than discarded.
   *
   * Computing a member's rank means ranking everybody, so this function already
   * pays for the whole table — five joins over CardOwnership. Handing it back
   * lets the page render the standings from this one call instead of asking a
   * second endpoint to compute the identical thing, which is what it used to
   * do: the most expensive read on the busiest path, run twice per page load.
   */
  standings: LeaderboardEntryDto[];
}> {
  const [owned, standings, roster] = await Promise.all([
    prisma.cardOwnership.findMany({
      where:  { userId, gameSeason: season },
      select: { cardId: true, nickname: true },
    }),
    readLeaderboard(season, userId),
    readRoster(userId, season),
  ]);

  const definitions = await prisma.cardDefinition.findMany({
    where:  { id: { in: owned.map((o) => o.cardId) } },
    select: CARD_FIELDS,
  });

  // Which cards have an uploaded portrait, and when it was uploaded. Only the
  // timestamp is read — the bytes are served per card by GET /api/cards/image,
  // because a member with forty customized cards would otherwise put ten
  // megabytes of base64 into this response.
  const cardIds = definitions.map((c) => c.id);
  const [overrides, portraits] = await Promise.all([
    prisma.cardImage.findMany({
      where:  { userId, gameSeason: season },
      select: { cardId: true, uploadedAt: true },
    }),
    // Not scoped to the member: a contributed portrait belongs to the card, so
    // whoever holds it this season sees the face somebody gave it.
    prisma.cardPortrait.findMany({
      where:  { cardId: { in: cardIds } },
      select: { cardId: true, createdAt: true },
    }),
  ]);
  const overrideAt = new Map(overrides.map((u) => [u.cardId, u.uploadedAt.getTime()]));
  const portraitAt = new Map(portraits.map((p) => [p.cardId, p.createdAt.getTime()]));

  // The nickname belongs to the ownership row, so it is joined on here rather
  // than selected with the card. Defaulted to null for a definition with no
  // matching ownership, which should not happen but is cheaper to tolerate
  // than to assert against.
  const customization = new Map(owned.map((o) => [o.cardId, o]));
  const cards: OwnedCardDto[] = definitions.map((card) => ({
    ...card,
    nickname: customization.get(card.id)?.nickname ?? null,
    // `v` is the upload time, so replacing a picture changes the URL and the
    // long immutable cache on the route stays correct. An override wins over a
    // contributed portrait — it is this season's owner's active choice.
    customImage: overrideAt.has(card.id) || portraitAt.has(card.id)
      ? `/api/cards/image?cardId=${encodeURIComponent(card.id)}` +
        `&v=${overrideAt.get(card.id) ?? portraitAt.get(card.id)}`
      : null,
    // Eligible only while the card has no face at all — not the pool's, and
    // not one somebody already contributed.
    eligibleForReward: isUnillustrated(card.headshot) && !portraitAt.has(card.id),
    isContributed: portraitAt.has(card.id) && !overrideAt.has(card.id),
  }));

  cards.sort(
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      b.season - a.season ||
      a.seasonRank - b.seasonRank,
  );

  // Counted from the deck in hand rather than read off the member's standings
  // row. The two agree for anyone with a User record, but sourcing the score
  // from the leaderboard made it depend on the member appearing there — and a
  // deck of 55 cards reporting a score of zero because its owner was missing
  // from one query is a confusing way to fail.
  const byTier = { HALL_OF_FAME: 0, GOLD: 0, SILVER: 0, BRONZE: 0 } as Record<CardTier, number>;
  for (const card of cards) byTier[card.tier] += 1;

  const mine = standings.find((entry) => entry.isYou);
  const started = roster.filter((s) => s.card).map((s) => s.card!);

  return {
    cards,
    roster,
    standings,
    stats: {
      cards:      cards.length,
      byTier,
      rosterPpg:  rosterPointsPerGame(started),
      deckAvgPpg: deckAveragePointsPerGame(cards),
      started:    started.length,
      // Null until somebody has actually fielded something — a table of zeroes
      // has no meaningful first place.
      rank:    mine && standings.some((e) => e.rosterPpg > 0) ? mine.rank : null,
      players: standings.length,
    },
  };
}

// ─── Rosters ──────────────────────────────────────────────────────────────────

/** The card columns roster scoring and display need. */
const ROSTER_CARD_FIELDS = CARD_FIELDS;

/**
 * A member's lineup, every slot in order, filled or not.
 *
 * A slot whose card no longer exists — a rebuild removed it — comes back empty
 * rather than broken, matching how the deck read drops orphaned ownership rows.
 */
export async function readRoster(userId: string, season: number): Promise<FilledSlot[]> {
  const slots = await prisma.rosterSlot.findMany({
    where:  { userId, gameSeason: season },
    select: { slot: true, cardId: true },
  });
  if (!slots.length) return layoutRoster(new Map());

  const cards = await prisma.cardDefinition.findMany({
    where:  { id: { in: slots.map((s) => s.cardId) } },
    select: ROSTER_CARD_FIELDS,
  });
  const byId = new Map(cards.map((c) => [c.id, c]));

  const assignments = new Map<string, RosterScorable>();
  for (const row of slots) {
    const card = byId.get(row.cardId);
    if (card) assignments.set(row.slot, card);
  }
  return layoutRoster(assignments);
}

/** Why a lineup change was refused. */
export type RosterFailure =
  | 'UNKNOWN_SLOT'
  | 'NOT_OWNED'
  | 'WRONG_POSITION';

/**
 * Puts a card in a slot, or empties the slot when `cardId` is null.
 *
 * Three things are checked, and all three have to be checked here rather than
 * trusted from the client: that the slot exists, that the member actually owns
 * the card, and that the card's position is eligible for the slot. The UI
 * filters the picker by the same rule, but a filtered picker is a convenience,
 * not a guard.
 *
 * A card already starting elsewhere is *moved* rather than rejected. The unique
 * key on (user, season, card) would refuse the insert, and "that player is
 * already in another slot" is a worse answer than just doing the obvious thing.
 */
export async function setRosterSlot(
  userId: string, season: number, slotId: string, cardId: string | null,
): Promise<{ ok: true } | { ok: false; reason: RosterFailure }> {
  if (!ROSTER_SLOT_IDS.includes(slotId)) return { ok: false, reason: 'UNKNOWN_SLOT' };

  if (cardId === null) {
    await prisma.rosterSlot.deleteMany({ where: { userId, gameSeason: season, slot: slotId } });
    return { ok: true };
  }

  const [owned, card] = await Promise.all([
    prisma.cardOwnership.findFirst({
      where:  { userId, gameSeason: season, cardId },
      select: { id: true },
    }),
    prisma.cardDefinition.findUnique({ where: { id: cardId }, select: { position: true } }),
  ]);

  if (!owned || !card) return { ok: false, reason: 'NOT_OWNED' };
  if (!slotAccepts(slotId, card.position)) return { ok: false, reason: 'WRONG_POSITION' };

  // Vacate wherever this card is currently starting, then take the slot.
  // Sequential rather than concurrent: both statements touch the same rows, and
  // the second depends on the first having freed the card's old seat.
  await prisma.rosterSlot.deleteMany({
    where: { userId, gameSeason: season, OR: [{ cardId }, { slot: slotId }] },
  });
  await prisma.rosterSlot.create({
    data: { userId, gameSeason: season, slot: slotId, cardId },
  });

  return { ok: true };
}

/** Why an open was refused, when it was. */
export type OpenFailure = 'NO_PACKS' | 'EMPTY_POOL';

export interface OpenSuccess {
  packTier: CardTier;
  /** True when this pack came from the Sleeper bonus supply. Same recipe as any other. */
  isBonus: boolean;
  /** Which supply the pack came from. */
  packKind: PackKind;
  cards: CardDto[];
  newCardIds: string[];
  /** The wildcard this pack carried, or null. Takes a card slot, not a sixth. */
  wildcard: PendingWildcardDto | null;
  allowance: AllowanceDto;
}

/**
 * Claims one card for a member, returning false if someone else got there
 * first.
 *
 * The unique index on (gameSeason, cardId) is the arbiter. Catching its
 * violation rather than checking first is deliberate: a check-then-write has a
 * window between the two, and this is exactly the operation two members racing
 * on the last Hall of Fame card will hit simultaneously.
 */
async function tryClaim(userId: string, season: number, cardId: string): Promise<boolean> {
  try {
    await prisma.cardOwnership.create({ data: { userId, gameSeason: season, cardId } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Whether this pack has to be forced to Gold to keep the week's promise.
 *
 * Each supply carries its own quota of Gold-or-better packs — two of the five
 * starters, and none of the weekly ration. Rather than pre-drawing a supply and
 * shuffling Golds into it, which would fix the whole thing the first time a
 * member loaded the page, the guarantee is a pity timer.
 *
 * A zero quota short-circuits below, so the ration never forces anything and
 * every ration pack is rolled on PACK_DROP_WEIGHT alone.
 *
 * The rule: force this pack if, even were every remaining pack in the same
 * supply to come up Gold, the member still could not reach that supply's quota.
 * For the starter grant that leaves the first three genuinely random and forces
 * the last two only if nothing has landed — so a member who rolls their own
 * Golds never notices the guarantee is there.
 *
 * A Hall of Fame pack counts. It is strictly better and carries Gold cards as
 * filler, so forcing a Gold afterwards would be a downgrade dressed up as a
 * guarantee.
 *
 * Supplies never subsidise each other: a starter Gold does not satisfy the
 * week's guarantee and a Sleeper bonus satisfies neither, which is why the
 * count is filtered by `kind` on both sides of the sum.
 *
 * @param week              The week to count within, or null for the starter
 *                          grant, which is seasonal rather than weekly.
 * @param remainingAfterThis Packs left in the same supply once this one is spent.
 */
async function mustForceGold(
  userId: string, season: number, kind: PackKind,
  week: number | null, remainingAfterThis: number,
): Promise<boolean> {
  const quota = GOLD_QUOTA[kind];
  if (quota === 0) return false;

  const goldOrBetter = await prisma.packOpening.count({
    where: {
      userId, gameSeason: season,
      kind,
      // The starter grant is not weekly, so its openings are counted across the
      // whole season rather than within one week.
      ...(week !== null ? { week } : {}),
      packTier: { in: ['GOLD', 'HALL_OF_FAME'] },
    },
  });

  // Best case from here is every remaining pack landing Gold on its own. If
  // that still falls short, this one has to be forced.
  return goldOrBetter + remainingAfterThis < quota;
}

/** Picks one unclaimed card of `tier`, falling back down the tiers below it. */
function pickReplacement(pool: CardPool, tier: CardTier, used: Set<string>): PoolCard | null {
  for (const candidateTier of [tier, ...lowerTiers(tier)]) {
    const options = (pool[candidateTier] ?? []).filter((c) => !used.has(c.id));
    if (options.length) return options[Math.floor(Math.random() * options.length)];
  }
  return null;
}

/**
 * Spends one of a member's packs, claims what it deals, and records it.
 *
 * Two races are handled, and they are different problems:
 *
 *   * The member's own balance. Two tabs clicking "open" would both pass a
 *     `remaining > 0` check, so the spend is a conditional update with the
 *     balance in its `where` — SQLite arbitrates and the loser is told it has
 *     no packs left.
 *
 *   * Other members' claims. The pool is read, then written to; between those
 *     two someone else may take a card this pack drew. Each claim is attempted
 *     individually and a lost one is redrawn against a freshly-read pool, so a
 *     contested pack still comes back with five cards rather than four.
 *
 * The pack is credited only after the spend succeeds, so a failed roll cannot
 * hand out cards for free — and a crash between the two costs the member a pack
 * rather than duplicating one, which is the safer way round.
 */
export async function openOnePack(
  userId: string, season: number, week: number, rng?: Rng,
): Promise<{ ok: true; result: OpenSuccess } | { ok: false; reason: OpenFailure }> {
  const [grant, starter] = await Promise.all([
    ensureGrant(userId, season, week),
    ensureStarterGrant(userId, season),
  ]);

  const { kind } = nextSupply(grant, starter);
  const isBonus = kind === 'BONUS';

  // Every spend is a conditional update with the balance in its `where`, so two
  // tabs clicking together cannot both draw from the same pack.
  const spent =
    kind === 'STARTER'
      ? await prisma.starterGrant.updateMany({
          where: {
            userId, gameSeason: season,
            packsOpened: { lt: prisma.starterGrant.fields.packsGranted },
          },
          data: { packsOpened: { increment: 1 } },
        })
      : kind === 'BONUS'
        ? await prisma.packGrant.updateMany({
            where: {
              userId, gameSeason: season, week,
              bonusOpened: { lt: prisma.packGrant.fields.bonusGranted },
            },
            data: { bonusOpened: { increment: 1 } },
          })
        : await prisma.packGrant.updateMany({
            where: {
              userId, gameSeason: season, week,
              packsOpened: { lt: prisma.packGrant.fields.packsGranted },
            },
            data: { packsOpened: { increment: 1 } },
          });
  if (spent.count === 0) return { ok: false, reason: 'NO_PACKS' };

  /** Hands the pack back to whichever supply it came from. */
  const refund = async () => {
    if (kind === 'STARTER') {
      await prisma.starterGrant.updateMany({
        where: { userId, gameSeason: season },
        data:  { packsOpened: { decrement: 1 } },
      });
      return;
    }
    await prisma.packGrant.updateMany({
      where: { userId, gameSeason: season, week },
      data:  kind === 'BONUS'
        ? { bonusOpened: { decrement: 1 } }
        : { packsOpened: { decrement: 1 } },
    });
  };

  const pool = await loadAvailablePool(season);

  // The tier was decided before the member tore the wrapper — that is the whole
  // point of showing it on the sealed pack. Opening honours what they were
  // shown rather than rolling again, which would make the label a lie.
  const grantNow = await prisma.packGrant.findUnique({
    where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
  });

  // Falls back to rolling now only for a grant that predates the pre-roll, or
  // one whose tier was somehow never written. A stored tier is always honoured
  // otherwise — it is what the member was shown on the wrapper. There used to
  // be an exception here for the bonus pack's Silver floor; every pack rolls
  // from the same table now, so there is nothing left to override.
  const storedTier = grantNow?.nextPackTier ?? null;

  const packTier = storedTier ?? rollPackTier(pool, rng ?? Math.random);

  if (!packTier) {
    await refund();
    return { ok: false, reason: 'EMPTY_POOL' };
  }

  const drawn = openPack(packTier, pool, rng ?? Math.random);

  if (!drawn.length) {
    await refund();
    return { ok: false, reason: 'EMPTY_POOL' };
  }

  // ── The wildcard, if this pack is carrying one ────────────────────────────
  //
  // Decided here rather than inside openPack because it is not a card: it never
  // touches the pool, is never claimed, and leaves the pack one player short.
  // Silver and better only — see WILDCARD_PACK_TIERS.
  //
  // The row is written after the cards are claimed, not now: a crash between
  // the two would otherwise leave a die a member never saw pulled.
  // A wildcard never takes the last slot. On a pool thin enough to deal a
  // one-card pack, displacing that card would leave nothing to reveal — and
  // refunding it as an empty pool would blame the pool for a coin flip.
  const hasWildcard = drawn.length > 1 && rollsWildcard(packTier, rng ?? Math.random);
  const displaced = hasWildcard ? weakestCardIndex(drawn) : -1;
  const opened = {
    packTier,
    cards: displaced >= 0 ? drawn.filter((_, i) => i !== displaced) : drawn,
  };

  // This pack is spent, so its tier is too. Cleared before the next one is
  // rolled so ensureNextPackTier below sees an empty slot to fill.
  await prisma.packGrant.updateMany({
    where: { userId, gameSeason: season, week },
    data:  { nextPackTier: null },
  });

  // ── Claim, redrawing around anything taken in the meantime ────────────────
  const claimed: PoolCard[] = [];
  const attempted = new Set<string>();
  let pending = opened.cards;

  for (let round = 0; round < MAX_CLAIM_ROUNDS && pending.length; round++) {
    const lost: CardTier[] = [];

    for (const card of pending) {
      attempted.add(card.id);
      if (await tryClaim(userId, season, card.id)) claimed.push(card);
      else lost.push(card.tier);
    }

    if (!lost.length) break;

    // Re-read: the pool this pack was drawn from is now known to be stale.
    const fresh = await loadAvailablePool(season, attempted);
    pending = [];
    for (const tier of lost) {
      const replacement = pickReplacement(fresh, tier, attempted);
      if (replacement) {
        attempted.add(replacement.id);
        pending.push(replacement);
      }
    }
  }

  if (!claimed.length) {
    await refund();
    return { ok: false, reason: 'EMPTY_POOL' };
  }

  const drawnIds = claimed.map((c) => c.id);

  const [cards, spentGrant] = await Promise.all([
    prisma.cardDefinition.findMany({ where: { id: { in: drawnIds } }, select: CARD_FIELDS }),
    prisma.packGrant.findUnique({
      where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
    }),
    prisma.packOpening.create({
      data: {
        userId, gameSeason: season, week,
        packTier: opened.packTier,
        kind,
        cardIds:  JSON.stringify(drawnIds),
      },
    }),
  ]);

  // Written only now that the pack has provably dealt something. `cardIds`
  // above deliberately does not mention it — that column is the audit of which
  // CardDefinitions were handed out, and a wildcard is not one of them.
  const wildcard = displaced >= 0
    ? await prisma.wildcardCard.create({
        data:   { userId, gameSeason: season, week },
        select: { id: true, week: true },
      })
    : null;

  const byId = new Map(cards.map((c) => [c.id, c]));
  // Reveal order is worst-first so the guaranteed card lands last: openPack
  // deals the headline card first, which is the wrong way round for a reveal.
  const revealed = drawnIds
    .map((id) => byId.get(id))
    .filter((c): c is CardDto => Boolean(c))
    .reverse();

  // Roll what comes next, so the wrapper the member sees on returning to the
  // page already has a tier. Failure here is not worth losing the pack over —
  // readAllowance rolls it on the next page load anyway.
  await ensureNextPackTier(userId, season, week, rng).catch(() => null);

  const [poolStats, nextGrant, nextStarter, wildcards] = await Promise.all([
    currentAllowance(),
    prisma.packGrant.findUnique({
      where: { userId_gameSeason_week: { userId, gameSeason: season, week } },
    }),
    prisma.starterGrant.findUnique({
      where: { userId_gameSeason: { userId, gameSeason: season } },
    }),
    pendingWildcards(userId, season),
  ]);

  return {
    ok: true,
    result: {
      packTier:   opened.packTier,
      isBonus,
      packKind:   kind,
      cards:      revealed,
      // Under exclusive ownership every card dealt is new to its owner.
      newCardIds: drawnIds,
      wildcard,
      allowance:  toAllowanceDto(
        nextGrant ?? spentGrant ?? { gameSeason: season, week, packsGranted: 0, packsOpened: 0 },
        poolStats,
        nextStarter,
        wildcards,
      ),
    },
  };
}

export { gameSeason };
