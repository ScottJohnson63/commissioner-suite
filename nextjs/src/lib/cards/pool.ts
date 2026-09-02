// src/lib/cards/pool.ts
//
// Turning the NFL stat table into a deck of cards.
//
// One card per (season, player): a player's regular season condensed to his PPR
// average, ranked against everyone else at his position that year, and tiered
// by where he finished. The pool is derived data and is rebuilt wholesale —
// there is nothing to migrate when a season is backfilled or a stat sync
// corrects a number, you just build it again.
//
// Only the four positions nflverse actually scores: QB, RB, WR and TE.
//
// Kickers and team defenses used to be here, scored by hand from the box score
// because nflverse's fantasy columns cover offence only. Both formulas leaned
// on columns the feed leaves empty — fumble recoveries, safeties, blocked kicks
// and field-goal distances are zero league-wide — so kickers ranked on flat
// make counts and the whole league of defenses spanned four points a game.
// Neither produced a card worth chasing, so both were dropped.
//
// Things the raw table does not give us, handled here:
//
//   * Games played. nflverse has no per-game fantasy column at all, and its
//     season summary's `games` count is exactly the number of weekly rows a
//     player has — verified equal for all 2,019 players of 2025 — so games are
//     counted from the rows already stored rather than synced separately.
//
//   * Jersey numbers, which are on nflverse's roster feed rather than the
//     player-stat feed. They arrive via NflSeasonRoster, filled by
//     sync_nfl_rosters.py, and are joined on here.
//
//   * A season total. NflWeeklyStat is per-week, so everything below sums over
//     the regular season. Postseason weeks are excluded: fantasy seasons are
//     over by then, and including them would rank players on games their
//     managers never got to use.

import { prisma } from '@/lib/prisma';
import type { CardTier } from '@prisma/client';
import { tierForRank } from '@/lib/cards/tiers';

/**
 * Earliest season eligible for the pool.
 *
 * 1999 is where nflverse's player-stat coverage begins, and the brief scoped
 * the game to "players from 1999+". It is a floor rather than a promise: the
 * builder uses whatever seasons the table actually holds, which today is
 * 2023-2025.
 */
export const CARD_POOL_MIN_SEASON = 1999;

/**
 * Games a player must have played to be ranked on his average.
 *
 * Tiers are set by points per game, which without a floor would hand a Hall of
 * Fame card to anyone who had one big afternoon and then vanished. Nine games
 * is half a season: enough that an average means something, low enough that a
 * genuinely elite player who missed six weeks still competes for the top tier
 * rather than being punished for being injured.
 *
 * Players below the floor still get cards — they played, so they are
 * collectible — but they are ranked beneath everyone who cleared it, which in
 * practice makes them Bronze.
 */
export const MIN_GAMES_FOR_TIER = 9;

/** A card about to be written, before it is ranked. */
interface ScoredPlayer {
  playerId: string;
  playerName: string;
  position: string;
  team: string | null;
  fantasyPoints: number;
  /** Games actually appeared in — the denominator for the card's headline. */
  gamesPlayed: number;
  headshot: string | null;
}

interface SkillRow {
  playerId: string;
  playerName: string | null;
  position: string;
  team: string | null;
  fantasyPoints: number | null;
  gamesPlayed: number | null;
  headshot: string | null;
}

/** Seasons the stat table actually holds, oldest first. */
export async function availableSeasons(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ season: number }[]>`
    SELECT DISTINCT season
      FROM NflWeeklyStat
     WHERE season >= ${CARD_POOL_MIN_SEASON}
     ORDER BY season
  `;
  return rows.map((r) => r.season);
}

/**
 * Season totals for every position that gets a card.
 *
 * `team` and `headshot` are bare columns beside a `MAX(week)` aggregate, which
 * SQLite resolves to the value from the row that supplied the maximum. That is
 * exactly what is wanted for a player who was traded mid-season: the card shows
 * the team they finished the year on.
 */
async function scoreSkillPlayers(season: number): Promise<ScoredPlayer[]> {
  const rows = await prisma.$queryRaw<SkillRow[]>`
    SELECT playerId,
           MAX(week),
           COALESCE(playerDisplayName, playerName) AS playerName,
           position,
           team,
           headshot,
           SUM(COALESCE(fantasyPointsPpr, 0)) AS fantasyPoints,
           COUNT(*) AS gamesPlayed
      FROM NflWeeklyStat
     WHERE season = ${season}
       AND seasonType = 'REG'
       AND position IN ('QB', 'RB', 'WR', 'TE')
     GROUP BY playerId
  `;

  return rows
    .filter((r) => (r.fantasyPoints ?? 0) > 0)
    .map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName ?? r.playerId,
      position: r.position,
      team: r.team,
      fantasyPoints: r.fantasyPoints ?? 0,
      gamesPlayed: Number(r.gamesPlayed ?? 0),
      headshot: r.headshot,
    }));
}

/** Points per game, or 0 for a player with no games. */
function perGame(player: ScoredPlayer): number {
  return player.gamesPlayed > 0 ? player.fantasyPoints / player.gamesPlayed : 0;
}

/**
 * Ranks one season's players within their own position and assigns each a tier.
 *
 * Two rules, both deliberate.
 *
 * **Per position, not league-wide.** The top five quarterbacks of a season are
 * Hall of Fame, and so are the top five kickers and the top five defenses. One
 * combined leaderboard would hand every rare card to the positions that simply
 * score more — no kicker or defense would ever clear a top-five cut against a
 * running back — and the point is that every position has cards worth chasing.
 * It also means `seasonRank` reads as "RB4 in 2025", which is how the card
 * face shows it.
 *
 * **By points per game, not by season total.** A card is a claim about how good
 * a player was, not how long he stayed fit, and the card face prints the
 * average — so ranking on the total would put a Gold card above a Hall of Fame
 * one on its own headline number.
 *
 * Players short of MIN_GAMES_FOR_TIER are sorted beneath everyone who cleared
 * it, ordered among themselves by the same average. They keep their cards, but
 * a three-game hot streak cannot outrank a season.
 *
 * Exported for the sake of testing the ranking rule without a database.
 */
export function rankSeason(
  players: ScoredPlayer[],
  season: number,
): (ScoredPlayer & { season: number; seasonRank: number; tier: CardTier })[] {
  const byPosition = new Map<string, ScoredPlayer[]>();
  for (const player of players) {
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  return [...byPosition.values()].flatMap((group) =>
    [...group]
      .sort((a, b) => {
        const aQualified = a.gamesPlayed >= MIN_GAMES_FOR_TIER;
        const bQualified = b.gamesPlayed >= MIN_GAMES_FOR_TIER;
        // Everyone who played enough comes first, whatever their average.
        if (aQualified !== bQualified) return aQualified ? -1 : 1;
        return (
          perGame(b) - perGame(a) ||
          // Ties broken by id so a rebuild produces the same tiers every time.
          a.playerId.localeCompare(b.playerId)
        );
      })
      .map((player, index) => ({
        ...player,
        season,
        seasonRank: index + 1,
        tier: tierForRank(index + 1),
      })),
  );
}

/**
 * Jersey numbers for one season, keyed on player id.
 *
 * Empty when the roster feed has not been synced for that season — the cards
 * then simply print no number rather than the build failing. Jersey numbers are
 * decoration; a missing one must never cost a member their card.
 */
async function jerseysForSeason(season: number): Promise<Map<string, number>> {
  const rows = await prisma.nflSeasonRoster.findMany({
    where:  { season, jerseyNumber: { not: null } },
    select: { playerId: true, jerseyNumber: true },
  });
  return new Map(rows.map((r) => [r.playerId, r.jerseyNumber as number]));
}

/**
 * The portrait each player's cards should show, keyed on player id.
 *
 * Not season-scoped: a portrait belongs to the man rather than the year, so one
 * lookup serves every season and this is read once per rebuild.
 *
 * This overrides `NflWeeklyStat.headshot` rather than supplementing it, and a
 * row holding null is the whole point of the table. nflverse's URL is an
 * nfl.com link that for about half the pool answers 200 with the league's
 * generic faceless-helmet silhouette instead of a photograph — so the raw
 * column cannot be trusted, and because the silhouette is a 200 rather than a
 * 404 the card's onError fallback never fired to rescue it. A row here says
 * "checked": either a URL verified to be a photograph, possibly recovered from
 * ESPN, or null meaning nobody has one and the card should show its team logo.
 *
 * Empty when sync_player_headshots.py has not been run, in which case the raw
 * column is used as before — a stale portrait must never cost a member a card.
 */
async function resolvedHeadshots(): Promise<Map<string, string | null>> {
  const rows = await prisma.nflPlayerHeadshot.findMany({
    select: { playerId: true, url: true },
  });
  return new Map(rows.map((r) => [r.playerId, r.url]));
}

export interface PoolBuildResult {
  seasons: number[];
  cardsBySeason: Record<number, number>;
  total: number;
}

/**
 * Rebuilds the whole card pool from the stat table.
 *
 * Destructive by design: CardDefinition is a projection, so the old rows are
 * dropped and rewritten rather than diffed. Member collections are untouched —
 * they reference cards by id with no foreign key, and ids are only reissued
 * when a card is genuinely new, so a rebuild after a stat correction leaves
 * everybody's collection intact.
 */
export async function rebuildCardPool(): Promise<PoolBuildResult> {
  const seasons = await availableSeasons();
  const cardsBySeason: Record<number, number> = {};

  // Existing ids, so a rebuild reuses them instead of orphaning collections.
  const existing = await prisma.cardDefinition.findMany({
    select: { id: true, season: true, playerId: true },
  });
  const idFor = new Map(existing.map((c) => [`${c.season}:${c.playerId}`, c.id]));

  const rows: {
    id?: string;
    season: number; playerId: string; playerName: string; position: string;
    team: string | null; tier: CardTier; seasonRank: number;
    fantasyPoints: number; gamesPlayed: number; pointsPerGame: number;
    jerseyNumber: number | null; headshot: string | null;
  }[] = [];

  const portraits = await resolvedHeadshots();

  for (const season of seasons) {
    const [skill, jerseys] = await Promise.all([
      scoreSkillPlayers(season),
      jerseysForSeason(season),
    ]);

    const ranked = rankSeason(skill, season);
    cardsBySeason[season] = ranked.length;

    for (const card of ranked) {
      const id = idFor.get(`${season}:${card.playerId}`);
      rows.push({
        ...(id ? { id } : {}),
        season,
        playerId:      card.playerId,
        playerName:    card.playerName,
        position:      card.position,
        team:          card.team,
        tier:          card.tier,
        seasonRank:    card.seasonRank,
        fantasyPoints: Math.round(card.fantasyPoints * 10) / 10,
        gamesPlayed:   card.gamesPlayed,
        // Guarded rather than divided blind: a card can exist with zero games
        // only if the stat rows are malformed, and a NaN would reach the card
        // face as "NaN PPG".
        pointsPerGame: card.gamesPlayed > 0
          ? Math.round((card.fantasyPoints / card.gamesPlayed) * 10) / 10
          : 0,
        // Null for a player whose roster row is missing upstream.
        jerseyNumber:  jerseys.get(card.playerId) ?? null,
        // The resolved portrait wins whenever the player has been checked,
        // including when the answer was "there is no photograph" — that null is
        // what sends the card to its team logo instead of nfl.com's silhouette.
        // `has` rather than `??`, so a deliberate null is not read as a miss.
        headshot:      portraits.has(card.playerId)
          ? portraits.get(card.playerId)!
          : card.headshot,
      });
    }
  }

  await prisma.cardDefinition.deleteMany({});

  // Chunked: SQLite caps how many bound parameters one statement may carry, and
  // a full 1999+ pool is far past it.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.cardDefinition.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  return { seasons, cardsBySeason, total: rows.length };
}
