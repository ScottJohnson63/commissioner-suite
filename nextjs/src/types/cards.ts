// src/types/cards.ts — wire shapes shared by the card-game routes and the UI.

import type { CardTier } from '@prisma/client';

export type { CardTier };

/** One card as the client sees it. Mirrors CardDefinition minus bookkeeping. */
export interface CardDto {
  id: string;
  season: number;
  playerId: string;
  playerName: string;
  position: string;
  team: string | null;
  tier: CardTier;
  seasonRank: number;
  /** Regular-season PPR total, which is what set the tier. */
  fantasyPoints: number;
  /** PPR points per game — the headline number on the card face. */
  pointsPerGame: number;
  gamesPlayed: number;
  /** Number worn that season, or null for defenses and missing roster rows. */
  jerseyNumber: number | null;
  headshot: string | null;
}

/**
 * A card in a member's deck.
 *
 * No count: ownership is exclusive, so a member holds a card or does not.
 *
 * The two customization fields live here rather than on CardDto because they
 * belong to the ownership, not the card — the pool is rebuilt wholesale and
 * would drop anything written onto a definition.
 */
export interface OwnedCardDto extends CardDto {
  /** What the owner calls it, or null for the player's real name. */
  nickname: string | null;
  /**
   * URL of the owner's uploaded portrait, or null for the pool's own.
   *
   * A URL rather than the image itself. The bytes live in their own table and
   * are served by GET /api/cards/image — inlining them here would put ten
   * megabytes on the wire for a member with forty customized cards. It carries
   * an upload timestamp so a replaced picture busts the browser cache.
   */
  customImage: string | null;
  /**
   * Whether uploading to this card would earn a pack: it has no portrait of its
   * own and nobody has contributed one. Surfaced so the UI can say so before
   * somebody uploads expecting a pack.
   */
  eligibleForReward: boolean;
  /**
   * True when this card's picture is a permanent contributed portrait rather
   * than a season-scoped override.
   */
  isContributed: boolean;
}

/** This week's pack ration, and the supply it is drawn from. */
export interface AllowanceDto {
  gameSeason: number;
  week: number;
  granted: number;
  opened: number;
  remaining: number;
  /** Cards in the pool in total. */
  poolSize: number;
  /** Cards already claimed by someone, league-wide. */
  claimed: number;
  /** Cards still unowned — what a pack actually draws from. */
  remainingCards: number;
  /** Accounts sharing the pool. */
  members: number;
  /** The flat weekly ration, before the wildcard. */
  perWeek: number;
  /**
   * The first week the ration is paid. Week 1 is the starter grant's week and
   * pays nothing on top of it, so the UI can say when `perWeek` starts rather
   * than promising packs that are not coming until next week.
   */
  rationStartsWeek: number;
  /**
   * Wildcards found and not yet thrown, oldest first.
   *
   * A list rather than a count: each die is thrown by id, and a member can be
   * holding several. Empty is the normal state.
   */
  pendingWildcards: PendingWildcardDto[];
  /**
   * The tier of the pack currently sealed and waiting — decided in advance so
   * the wrapper can show what it is. Null only when the pool is empty.
   */
  nextPackTier: CardTier | null;
  /** Sleeper bonus packs earned this week and not yet opened. */
  bonusRemaining: number;
  /** One-off welcome packs not yet opened. */
  starterRemaining: number;
  /** Which supply the sealed pack comes from. */
  nextPackKind: PackKind;
  /** Whether the sealed pack comes from the Sleeper bonus supply. */
  nextPackIsBonus: boolean;
}

/** Which supply a pack came out of. */
export type PackKind = 'STARTER' | 'BONUS' | 'RATION';

/** Why a member earned a bonus pack. */
export type BonusKind = 'WIN' | 'HIGH_SCORE';

/** A bonus pack earned from a Sleeper result this week. */
export interface BonusAwardDto {
  kind: BonusKind;
  sleeperLeagueId: string | null;
  points: number | null;
}

/** A wildcard in hand, waiting to be thrown. */
export interface PendingWildcardDto {
  id: string;
  /** The week the pack it came out of was opened. */
  week: number;
}

/** POST /api/cards/wildcard */
export interface WildcardResponse {
  /** The wildcard this response is about. */
  id: string;
  /** False when this die had already been thrown. */
  rolled: boolean;
  /** The face that stuck — this request's roll, or the earlier one. */
  value: number;
  packsGranted: number;
  week: number;
  gameSeason: number;
}

/** One slot of the starting lineup, and whatever is in it. */
export interface RosterSlotDto {
  /** Slot id — QB, RB1, FLEX1 … */
  id: string;
  /** What it is called on screen. Several slots share a label. */
  label: string;
  /** Positions eligible for the slot. */
  accepts: readonly string[];
  card: CardDto | null;
}

/** How a member is doing. */
export interface DeckStatsDto {
  /** Cards owned. */
  cards: number;
  /** Cards held at each tier. */
  byTier: Record<CardTier, number>;
  /**
   * Combined points per game of the starting lineup. This is what the
   * standings rank on.
   */
  rosterPpg: number;
  /** Average points per game across every card owned. */
  deckAvgPpg: number;
  /** Slots filled, out of ROSTER_SIZE. */
  started: number;
  /** Where that places them, or null before anyone has fielded anything. */
  rank: number | null;
  players: number;
}

/** One row of the season standings. */
export interface LeaderboardEntryDto {
  userId: string;
  name: string;
  rank: number;
  cards: number;
  /** Combined points per game of their lineup — the ranking figure. */
  rosterPpg: number;
  /** Average points per game across their whole deck. */
  deckAvgPpg: number;
  /** Slots they have filled. */
  started: number;
  byTier: Record<CardTier, number>;
  /** True for the signed-in member, so the UI can highlight their row. */
  isYou: boolean;
}

/** Bonus packs held this week, and what earned them. */
export interface BonusStateDto {
  /** Rules satisfied this week. */
  kinds: BonusKind[];
  /** Awards granted by the request that returned this — for a "you earned!" toast. */
  awarded: BonusAwardDto[];
  /** The score a member must beat for the high-score pack. */
  threshold: number;
}

/** GET /api/cards/collection */
export interface CollectionResponse {
  allowance: AllowanceDto;
  stats: DeckStatsDto;
  cards: OwnedCardDto[];
  /** Every lineup slot in order, filled or not. */
  roster: RosterSlotDto[];
  /** The season standings, computed alongside the deck rather than separately. */
  standings: LeaderboardEntryDto[];
  /** Sleeper bonus packs earned this week. */
  bonus: BonusStateDto;
  seasons: number[];
}

/** POST /api/cards/image */
export interface CustomizeResponse {
  cardId: string;
  nickname: string | null;
  /** True when a picture is stored for this card, of either kind. */
  hasCustomImage: boolean;
  /**
   * True when the stored picture is a permanent contributed portrait rather
   * than a season-scoped override — it will outlive the end-of-season reset.
   */
  isContributed: boolean;
  /**
   * Whether uploading to this card would earn a pack: it has no portrait of its
   * own and nobody has contributed one.
   */
  eligibleForReward: boolean;
  /** Packs paid by this request — non-zero only on the one that completed it. */
  packsAwarded: number;
  /** Packs earned this way all season, after this request. */
  packsEarnedTotal: number;
  /** Cards that can still earn, or 0 at the season cap. */
  rewardsRemaining: number;
}

/** PUT /api/cards/roster */
export interface RosterUpdateResponse {
  roster: RosterSlotDto[];
  stats: DeckStatsDto;
}

/** GET /api/cards/leaderboard */
export interface LeaderboardResponse {
  gameSeason: number;
  entries: LeaderboardEntryDto[];
}

/** POST /api/cards/open */
export interface OpenPackResponse {
  packTier: CardTier;
  /** True when this pack came from the Sleeper bonus supply. */
  isBonus: boolean;
  /** Which supply the pack came from. */
  packKind: PackKind;
  /** Reveal order, best card last so the UI can build to it. */
  cards: CardDto[];
  /**
   * Cards in this pack nobody had claimed before — which, under exclusive
   * ownership, is every card the pack successfully dealt.
   */
  newCardIds: string[];
  /**
   * The wildcard this pack carried, or null.
   *
   * It occupies one of the pack's card slots rather than adding a sixth, so a
   * pack that found one deals one fewer player — see WILDCARD_PULL_CHANCE.
   */
  wildcard: PendingWildcardDto | null;
  allowance: AllowanceDto;
}
