// src/lib/cards/weekly.ts
//
// The weekly submission game: freezing a lineup at the deadline, retiring the
// cards that played, and publishing what everybody put up.
//
// The rules, in four sentences. Set a lineup and submit it before Monday
// 11:59pm central. At Tuesday 10am central every submission is published, best
// to worst. A card that has played is retired and cannot be played again. Your
// weekly scores add up, and the highest season total wins.
//
// Three of those four are enforced here; the fourth — the clock — is
// weeklyGame.ts, which is pure and knows nothing about a database.
//
// ── Why anything is frozen at all ───────────────────────────────────────────
//
// A submission stores its own copy of the lineup, its own points, and its own
// deadline. None of that could be recomputed later and still be honest: the
// working lineup keeps being edited after the deadline, `pointsPerGame` moves
// whenever a commissioner rebuilds the pool, and a change to the deadline rule
// would restate weeks that closed months ago. What a lineup scored is what it
// scored on the Monday night it locked.
//
// ── Retirement is an index, not a check ─────────────────────────────────────
//
// `LineupCard` is unique on (userId, gameSeason, cardId), so playing a card
// twice is refused by SQLite rather than by an `if` this module could race
// against. Everything below treats the index as the rule and the filtering as
// the courtesy — the picker hides retired cards, and the database is what makes
// hiding them optional.

import { prisma } from '@/lib/prisma';
import { CARD_FIELDS, isUniqueViolation } from '@/lib/cards/db';
import { eligiblePlayerWhere } from '@/lib/cards/eligibility';
import {
  currentWindow, formatCentral, lastRevealedWeek, phaseOf, revealAt, revealedWeeks,
  seasonOver, type WeekPhase,
} from '@/lib/cards/weeklyGame';
import type {
  PlayedCardDto, SubmittedLineupDto, WeekEntryDto, WeekResultsDto, WeeklyStateDto,
} from '@/types/cards';

/** One decimal, the way every other score in the game is rounded. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A card that has already played, and what it did. */
export interface RetiredCard {
  cardId: string;
  week: number;
  points: number;
}

/**
 * The cards a member has already played this season, by card id.
 *
 * Keyed off the *lock* rather than the reveal: the games are over by Monday
 * midnight, so the cards have played whether or not the results have been
 * published yet. The ten hours in between are the one window where that
 * distinction is visible, and during them the deck should already show those
 * cards as spent — they are, and no amount of waiting will bring them back.
 */
export async function retiredCards(
  userId: string, season: number, now: Date = new Date(),
): Promise<Map<string, RetiredCard>> {
  const rows = await prisma.lineupCard.findMany({
    where:  { userId, gameSeason: season, submission: { lockAt: { lte: now } } },
    select: { cardId: true, week: true, points: true },
  });
  return new Map(rows.map((r) => [r.cardId, r]));
}

/**
 * Clears lineup slots holding cards that have retired.
 *
 * A member's working lineup still points at last week's starters on Tuesday
 * morning, and those cards can never start again — so leaving them in place
 * would show nine slots that look filled and score nothing. Emptied lazily on
 * read rather than by a scheduled job, which is how every other clock-driven
 * thing in this game works: the pack grant and the starter grant are both
 * created the first time a member looks.
 *
 * Returns how many slots it freed, so a caller can tell a member why their
 * lineup emptied itself.
 */
export async function clearRetiredSlots(
  userId: string, season: number, now: Date = new Date(),
): Promise<number> {
  const retired = await retiredCards(userId, season, now);
  if (!retired.size) return 0;

  const { count } = await prisma.rosterSlot.deleteMany({
    where: { userId, gameSeason: season, cardId: { in: [...retired.keys()] } },
  });
  return count;
}

/** A member's frozen lineup for one week, or null if they never submitted. */
export async function readSubmission(
  userId: string, season: number, week: number,
): Promise<SubmittedLineupDto | null> {
  const row = await prisma.lineupSubmission.findUnique({
    where:  { userId_gameSeason_week: { userId, gameSeason: season, week } },
    select: {
      week: true, submittedAt: true, points: true, filled: true,
      cards: { select: { slot: true, cardId: true, points: true } },
    },
  });
  if (!row) return null;

  return {
    week:        row.week,
    submittedAt: row.submittedAt.toISOString(),
    points:      row.points,
    filled:      row.filled,
    slots:       row.cards.map((c) => ({ slot: c.slot, cardId: c.cardId, points: c.points })),
  };
}

/**
 * Every member's season total, from published weeks only.
 *
 * Bounded by `revealAt` rather than by `lockAt`, which is the difference
 * between a scoreboard and a spoiler: the cards retire on Monday night, but
 * nobody learns what anything scored until Tuesday morning, and a standings
 * table that moved at midnight would give the week away ten hours early.
 *
 * Read and summed in memory rather than aggregated in SQL. It is one small
 * indexed scan — a twelve-member league plays 216 rows over a whole season —
 * and doing it here keeps the arithmetic in the same place as the rounding.
 */
export async function seasonScores(
  season: number, now: Date = new Date(),
): Promise<Map<string, { points: number; weeks: number }>> {
  const rows = await prisma.lineupSubmission.findMany({
    where:  { gameSeason: season, revealAt: { lte: now } },
    select: { userId: true, points: true },
  });

  const totals = new Map<string, { points: number; weeks: number }>();
  for (const row of rows) {
    const seat = totals.get(row.userId) ?? { points: 0, weeks: 0 };
    totals.set(row.userId, { points: seat.points + row.points, weeks: seat.weeks + 1 });
  }
  // Rounded once at the end. Rounding each week and summing the results drifts
  // by a tenth or two over a season, and a season total that does not equal the
  // weeks printed above it is the kind of thing a league argues about.
  for (const [userId, seat] of totals) {
    totals.set(userId, { points: round1(seat.points), weeks: seat.weeks });
  }
  return totals;
}

// ─── Submitting ──────────────────────────────────────────────────────────────

/** Why a submission was refused. */
export type SubmitFailure =
  /** Past Monday 11:59pm central. */
  | 'LOCKED'
  /** Week 18's results are out; there is nothing left to play. */
  | 'SEASON_OVER'
  /** Nothing in the lineup that has not already played. */
  | 'EMPTY'
  /** A card in the lineup has already played this season. */
  | 'RETIRED';

export interface SubmitResult {
  week: number;
  points: number;
  filled: number;
  lockAt: Date;
  revealAt: Date;
}

/**
 * Freezes the member's working lineup as this week's submission.
 *
 * Re-submitting overwrites: the lineup is editable right up to the deadline, so
 * "submit" is a save rather than a one-way door, and the deadline is the only
 * thing that stops it. That is why the row is deleted and rewritten rather than
 * updated in place — a lineup with fewer cards than last time has to lose the
 * slots it dropped, and an upsert of nine rows leaves the tenth behind.
 *
 * Children are deleted explicitly ahead of the parent even though the relation
 * cascades. SQLite only honours a foreign key when `PRAGMA foreign_keys` is on,
 * and nothing in this app guarantees the adapter sets it — an orphaned
 * `LineupCard` would go on retiring a card whose submission no longer exists.
 */
export async function submitLineup(
  userId: string, season: number, now: Date = new Date(),
): Promise<{ ok: true; result: SubmitResult } | { ok: false; reason: SubmitFailure }> {
  if (seasonOver(season, now)) return { ok: false, reason: 'SEASON_OVER' };

  const window = currentWindow(season, now);
  if (phaseOf(window, now) !== 'OPEN') return { ok: false, reason: 'LOCKED' };

  const [slots, retired] = await Promise.all([
    prisma.rosterSlot.findMany({
      where:  { userId, gameSeason: season },
      select: { slot: true, cardId: true },
    }),
    retiredCards(userId, season, now),
  ]);

  // A retired card in the lineup is a slot that has not been cleaned up yet
  // rather than an attempt to cheat, so it is dropped quietly here; the index
  // would refuse it anyway, and refusing the whole submission over a stale slot
  // would be a worse answer than submitting the eight that are still live.
  const live = slots.filter((s) => !retired.has(s.cardId));
  if (!live.length) return { ok: false, reason: 'EMPTY' };

  // Points come from the card as it stands right now, and are then frozen — see
  // the note at the top. A slot whose card a rebuild removed is dropped rather
  // than scored as zero, matching how the deck read treats orphaned ownerships.
  const definitions = await prisma.cardDefinition.findMany({
    where:  { id: { in: live.map((s) => s.cardId) } },
    select: { id: true, pointsPerGame: true },
  });
  const ppg = new Map(definitions.map((c) => [c.id, c.pointsPerGame]));

  const rows = live
    .filter((s) => ppg.has(s.cardId))
    .map((s) => ({
      userId,
      gameSeason: season,
      week:       window.week,
      slot:       s.slot,
      cardId:     s.cardId,
      points:     ppg.get(s.cardId) ?? 0,
    }));
  if (!rows.length) return { ok: false, reason: 'EMPTY' };

  const points = round1(rows.reduce((sum, r) => sum + r.points, 0));

  try {
    await prisma.$transaction([
      prisma.lineupCard.deleteMany({ where: { userId, gameSeason: season, week: window.week } }),
      prisma.lineupSubmission.deleteMany({
        where: { userId, gameSeason: season, week: window.week },
      }),
      prisma.lineupSubmission.create({
        data: {
          userId,
          gameSeason: season,
          week:       window.week,
          lockAt:     window.lockAt,
          revealAt:   window.revealAt,
          points,
          filled:     rows.length,
          cards:      { create: rows.map(({ ...card }) => card) },
        },
      }),
    ]);
  } catch (error) {
    // The (userId, gameSeason, cardId) index rejecting the write means one of
    // these cards played in an earlier week — the retirement rule, arriving
    // from the database rather than from the filter above.
    if (isUniqueViolation(error)) return { ok: false, reason: 'RETIRED' };
    throw error;
  }

  return {
    ok: true,
    result: {
      week:     window.week,
      points,
      filled:   rows.length,
      lockAt:   window.lockAt,
      revealAt: window.revealAt,
    },
  };
}

// ─── The member's own view of the week ───────────────────────────────────────

/**
 * Where the member stands in this week's cycle: the deadline, whether they have
 * submitted, and what the season has paid them so far.
 *
 * Everything the lineup page needs to decide what to say — and the deadlines
 * are sent as both an instant and a rendered central-time label, so a browser
 * in another zone counts down correctly *and* still shows the rule as written.
 */
export async function readWeeklyState(
  userId: string, season: number, now: Date = new Date(),
): Promise<WeeklyStateDto> {
  const window = currentWindow(season, now);
  const phase: WeekPhase = phaseOf(window, now);

  const [submitted, retired, scores] = await Promise.all([
    readSubmission(userId, season, window.week),
    retiredCards(userId, season, now),
    seasonScores(season, now),
  ]);

  const mine = scores.get(userId) ?? { points: 0, weeks: 0 };

  return {
    week:          window.week,
    phase,
    lockAt:        window.lockAt.toISOString(),
    revealAt:      window.revealAt.toISOString(),
    lockLabel:     formatCentral(window.lockAt),
    revealLabel:   formatCentral(window.revealAt),
    seasonOver:    seasonOver(season, now),
    submitted,
    revealedWeeks: revealedWeeks(season, now),
    retired:       retired.size,
    seasonPoints:  mine.points,
    weeksPlayed:   mine.weeks,
  };
}

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * What everybody played in one week, once it has been published.
 *
 * Returns null before Tuesday 10am central for that week. That guard is the
 * whole reveal: with it the route cannot leak a lineup early however the week
 * is asked for, and without it the deadline would be a UI convention.
 *
 * Two orderings come back because two questions are being asked. `entries`
 * ranks the members — who won the week — and `cards` is every card anybody
 * played, best to worst, which is where a nicknamed card with somebody's own
 * photograph on it gets to be the best card of the week in front of the league.
 */
export async function readWeekResults(
  season: number, week: number, viewerId: string, now: Date = new Date(),
): Promise<WeekResultsDto | null> {
  if (week < 1 || now.getTime() < revealAt(season, week).getTime()) return null;

  const submissions = await prisma.lineupSubmission.findMany({
    where:  { gameSeason: season, week },
    select: {
      userId: true, points: true, filled: true, submittedAt: true,
      cards: { select: { slot: true, cardId: true, points: true } },
    },
  });

  const cardIds = [...new Set(submissions.flatMap((s) => s.cards.map((c) => c.cardId)))];

  const [users, definitions, ownerships, overrides, portraits] = await Promise.all([
    prisma.user.findMany({
      where:  eligiblePlayerWhere(),
      select: { id: true, name: true, username: true },
    }),
    prisma.cardDefinition.findMany({ where: { id: { in: cardIds } }, select: CARD_FIELDS }),
    // Nicknames belong to the ownership, not the card — see CardOwnership.
    prisma.cardOwnership.findMany({
      where:  { gameSeason: season, cardId: { in: cardIds } },
      select: { cardId: true, nickname: true },
    }),
    prisma.cardImage.findMany({
      where:  { gameSeason: season, cardId: { in: cardIds } },
      select: { cardId: true, uploadedAt: true },
    }),
    prisma.cardPortrait.findMany({
      where:  { cardId: { in: cardIds } },
      select: { cardId: true, createdAt: true },
    }),
  ]);

  const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.username]));
  const cardById = new Map(definitions.map((c) => [c.id, c]));
  const nickname = new Map(ownerships.map((o) => [o.cardId, o.nickname]));
  const overrideAt = new Map(overrides.map((o) => [o.cardId, o.uploadedAt.getTime()]));
  const portraitAt = new Map(portraits.map((p) => [p.cardId, p.createdAt.getTime()]));

  /** The same precedence the deck read uses: override, then contributed. */
  const imageFor = (cardId: string): string | null => {
    const version = overrideAt.get(cardId) ?? portraitAt.get(cardId);
    if (version === undefined) return null;
    return `/api/cards/image?cardId=${encodeURIComponent(cardId)}&v=${version}`;
  };

  const entries: WeekEntryDto[] = submissions
    // A submission from an account the members page hides — the seeded
    // superuser — is dropped rather than ranked, matching the standings.
    .filter((s) => nameOf.has(s.userId))
    .map((submission) => {
      const cards: PlayedCardDto[] = submission.cards
        .flatMap((played) => {
          const card = cardById.get(played.cardId);
          if (!card) return [];
          return [{
            ...card,
            nickname:    nickname.get(card.id) ?? null,
            customImage: imageFor(card.id),
            slot:        played.slot,
            points:      played.points,
            ownerId:     submission.userId,
            ownerName:   nameOf.get(submission.userId) ?? '',
            isYou:       submission.userId === viewerId,
          }];
        })
        .sort((a, b) => b.points - a.points);

      return {
        userId:      submission.userId,
        name:        nameOf.get(submission.userId) ?? '',
        isYou:       submission.userId === viewerId,
        rank:        0,
        points:      round1(submission.points),
        filled:      submission.filled,
        submittedAt: submission.submittedAt.toISOString(),
        cards,
      };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    gameSeason: season,
    week,
    revealedAt: revealAt(season, week).toISOString(),
    entries,
    cards: entries.flatMap((e) => e.cards).sort((a, b) => b.points - a.points),
    weeks: revealedWeeks(season, now),
  };
}

/**
 * The week the results view should open on: the most recent one published.
 *
 * Null before the season's first Tuesday, which the page renders as "no results
 * yet" rather than as an empty table.
 */
export function defaultResultsWeek(season: number, now: Date = new Date()): number | null {
  return lastRevealedWeek(season, now);
}
