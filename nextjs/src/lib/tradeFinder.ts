// src/lib/tradeFinder.ts
//
// Which players a roster can actually afford to trade, and what a deal does to
// the lineup that has to play next week.
//
// The trade finder used to answer both questions with the same one: it took a
// roster's best player at a position and offered him, one proposal per position
// pair. That is nearly always the wrong player. A roster is strong at running
// back *because* its RB1 is elite — sending that RB1 out to patch tight end
// trades the strength for the void and ends up flat, and because the same
// player is the only candidate the position ever offers, every proposal built
// on it is the same trade wearing a different partner's name.
//
// The player a deep roster can genuinely spare is the one behind the starter
// line — the RB3 in a league that starts two — and losing him costs the lineup
// nothing. So nothing here is measured on the player in isolation. Everything
// is measured on the starting lineup:
//
//   • what a roster loses by sending a player out  = his points, minus the
//     points of whoever slides up into his slot (zero, behind the line);
//   • what it gains by taking a player in          = what he adds over the
//     starter he displaces (his whole total, into an empty slot).
//
// Both fall out of one function, `lineupDelta`, run over each side of the same
// deal — which is also what lets the finder ask the question it never asked
// before: would the other manager say yes? A proposal survives only when both
// lineups come out ahead, so the pieces each side offers are drawn from its own
// surplus and aimed at its own hole.
//
// Depth is counted over the named starting slots the league actually uses (see
// src/lib/sleeper/lineup.ts). FLEX is not attributed to any position there and
// is not attributed here either, so a flex-quality bench piece reads as free to
// trade. The explicit slots either side of a flex already carry the depth
// question, and inventing a share of the flex for three positions would claim a
// league starts more running backs than it does.

/** Positions with fantasy value on both sides of a trade. */
export const TRADE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
export type TradePos = (typeof TRADE_POSITIONS)[number];

export function isTradePos(p: string | null | undefined): p is TradePos {
  return !!p && (TRADE_POSITIONS as readonly string[]).includes(p);
}

/** A rostered player, before his own roster's depth chart is worked out. */
export interface RosterEntry {
  playerId:  string;
  name:      string;
  position:  TradePos;
  seasonPts: number;
}

/** The same player, placed on his roster's depth chart. */
export interface DepthPlayer extends RosterEntry {
  /** 1 = the best at this position on this roster. */
  depthRank: number;
  /** Inside the starting slots this league gives the position. */
  starter:   boolean;
  /**
   * Points the starting lineup loses if he is traded away — his own total minus
   * the total of the man who slides up. Zero for anyone already behind the
   * line, which is what makes him the piece to offer.
   */
  cost:      number;
}

/** One roster, read as a depth chart rather than a bag of players. */
export interface RosterShape {
  ownerId:   string;
  /** Players by position, best first. Every position present, possibly empty. */
  byPos:     Record<TradePos, DepthPlayer[]>;
  /** Points the starting lineup scores as it stands. */
  lineupPts: number;
}

/** A trade the finder is willing to put its name to. */
export interface TradeCandidate {
  targetOwnerId: string;
  give:          DepthPlayer[];
  receive:       DepthPlayer[];
  /** 0–100; 100 is an even split of season points. */
  fairnessScore: number;
  /** Points this adds to my starting lineup. Always > 0. */
  myGain:        number;
  /** Points it adds to theirs — the reason they would accept. Always > 0. */
  theirGain:     number;
}

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Below this a proposal is too lopsided in raw points to send. */
export const MIN_FAIRNESS = 60;

/** Players considered from each side, per partner. Enough for variety, small
 *  enough that the package search stays a few hundred combinations. */
const MAX_CHIPS = 6;

/** How often one player, or one partner, may appear across the returned set.
 *  The whole point is a spread of ideas rather than the same name five times. */
const MAX_PER_PLAYER = 2;
const MAX_PER_TEAM   = 2;

/**
 * Smallest gain worth proposing, as a share of the lineup being improved.
 *
 * A trade is only worth sending if somebody notices it happened. Ten points
 * across a whole season on a lineup that scores thirteen hundred is inside the
 * noise of the totals it was computed from, and filling the list with deals
 * like that is how a shortlist stops being one. Relative rather than absolute,
 * because these are running season totals: the same fixed floor is most of a
 * lineup in week two and a rounding error in week seventeen.
 */
const MIN_GAIN_SHARE = 0.01;

// ─── Lineup arithmetic ────────────────────────────────────────────────────────

/** Points of the best `slots` entries. 0 when the league starts none. */
function topSum(entries: readonly { seasonPts: number }[], slots: number): number {
  if (slots <= 0 || entries.length === 0) return 0;
  return [...entries]
    .sort((a, b) => b.seasonPts - a.seasonPts)
    .slice(0, slots)
    .reduce((sum, e) => sum + e.seasonPts, 0);
}

function emptyByPos(): Record<TradePos, DepthPlayer[]> {
  return { QB: [], RB: [], WR: [], TE: [], K: [] };
}

/**
 * Change in a roster's starting-lineup points if `out` leaves and `incoming`
 * arrives — positive means the lineup is better off.
 *
 * Only the positions the deal touches are recomputed; the rest of the lineup is
 * unchanged by definition, so it cancels.
 */
export function lineupDelta(
  shape:    RosterShape,
  slots:    Record<string, number>,
  out:      readonly RosterEntry[],
  incoming: readonly RosterEntry[],
): number {
  const touched = new Set<TradePos>([...out, ...incoming].map((p) => p.position));
  let delta = 0;
  for (const pos of touched) {
    const before = shape.byPos[pos] ?? [];
    const gone   = new Set(out.filter((p) => p.position === pos).map((p) => p.playerId));
    const after  = [
      ...before.filter((e) => !gone.has(e.playerId)),
      ...incoming.filter((p) => p.position === pos),
    ];
    const n = slots[pos] ?? 0;
    delta += topSum(after, n) - topSum(before, n);
  }
  return delta;
}

/**
 * Sorts a roster into a depth chart and prices every player on it.
 *
 * @param slots  Named starting slots per position, from getStarterSlots.
 */
export function buildRosterShape(
  ownerId: string,
  players: readonly RosterEntry[],
  slots:   Record<string, number>,
): RosterShape {
  const byPos = emptyByPos();
  for (const p of players) {
    byPos[p.position].push({ ...p, depthRank: 0, starter: false, cost: 0 });
  }

  let lineupPts = 0;
  for (const pos of TRADE_POSITIONS) {
    const group = byPos[pos].sort((a, b) => b.seasonPts - a.seasonPts);
    const n     = slots[pos] ?? 0;
    group.forEach((p, i) => { p.depthRank = i + 1; p.starter = i < n; });
    lineupPts += topSum(group, n);
  }

  const shape: RosterShape = { ownerId, byPos, lineupPts };
  // Priced against the finished chart, so the replacement a player is measured
  // against is the one who would really slide up. Clamped at zero because losing
  // a player never improves a lineup, and because -0 prints as "-0".
  for (const pos of TRADE_POSITIONS) {
    for (const p of shape.byPos[pos]) {
      p.cost = Math.max(0, -lineupDelta(shape, slots, [p], []));
    }
  }
  return shape;
}

/** Every player on a shape, in no particular order. */
function allPlayers(shape: RosterShape): DepthPlayer[] {
  return TRADE_POSITIONS.flatMap((pos) => shape.byPos[pos]);
}

/**
 * Points a roster starts at one position — the figure its league rank is taken
 * on. Two RB slots means the top two, not the best one.
 */
export function positionStrength(
  shape: RosterShape,
  pos:   TradePos,
  slots: Record<string, number>,
): number {
  return topSum(shape.byPos[pos] ?? [], slots[pos] ?? 0);
}

/**
 * Trade fairness from 0–100, on raw season points.
 *
 * 100 is an even split. It is deliberately a separate test from the two lineup
 * deltas: those say both rosters improve, this says the deal still looks like a
 * trade rather than a fleecing when the other manager reads the two names.
 */
export function fairness(givePts: number, receivePts: number): number {
  const denom = Math.max(givePts, receivePts, 1);
  return Math.max(0, Math.min(100, 100 - (100 * Math.abs(givePts - receivePts)) / denom));
}

// ─── Proposal search ──────────────────────────────────────────────────────────

/**
 * Every one- and two-player side that can be built from a list.
 *
 * Two is the ceiling on purpose: three-for-one is a negotiation rather than a
 * suggestion, it does not fit the panel, and the search grows with the cube of
 * the candidate list.
 */
function singlesAndPairs<T>(list: readonly T[]): T[][] {
  const out: T[][] = list.map((x) => [x]);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

const sumPts = (ps: readonly RosterEntry[]) => ps.reduce((s, p) => s + p.seasonPts, 0);

/**
 * The players I can most afford to send: worth something to somebody else,
 * cheap to my own lineup. An RB3 behind two startable backs scores his whole
 * total here; an RB1 with nothing behind him scores zero.
 *
 * My two highest scorers are added regardless: a one-for-two — sending a real
 * starter out and getting two pieces back — needs a real starter to offer, and
 * the surplus measure will never nominate one.
 */
function tradeChips(shape: RosterShape): DepthPlayer[] {
  const scored  = allPlayers(shape).filter((p) => p.seasonPts > 0);
  const surplus = [...scored].sort((a, b) => (b.seasonPts - b.cost) - (a.seasonPts - a.cost))
                             .slice(0, MAX_CHIPS);
  const best    = [...scored].sort((a, b) => b.seasonPts - a.seasonPts).slice(0, 2);

  const seen = new Set<string>();
  return [...surplus, ...best].filter((p) => {
    if (seen.has(p.playerId)) return false;
    seen.add(p.playerId);
    return true;
  });
}

/** Their players who would actually start for me, best upgrade first. */
function targetsOn(
  them:  RosterShape,
  me:    RosterShape,
  slots: Record<string, number>,
): DepthPlayer[] {
  return allPlayers(them)
    .map((p) => ({ p, gain: lineupDelta(me, slots, [], [p]) }))
    .filter((c) => c.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, MAX_CHIPS)
    .map((c) => c.p);
}

/**
 * Whether a roster can still fill every starting slot it fills today.
 *
 * The lineup arithmetic values an empty slot at zero, which is right as far as
 * it goes — a slot with nobody in it scores nothing — but it makes emptying one
 * look like a price worth paying for a big enough return. It is not a price
 * anyone can actually pay: the lineup still has to be submitted, and a manager
 * who trades away his only quarterback has not improved his team, he has moved
 * the hole. (Streaming the position off waivers is the real answer, and this
 * module cannot see the waiver wire — which is the same reason it does not try
 * to price a replacement.)
 *
 * A slot that is *already* empty is a different case and stays allowed: filling
 * it is most of what the finder is for.
 */
function keepsLineupFillable(
  shape:    RosterShape,
  slots:    Record<string, number>,
  out:      readonly RosterEntry[],
  incoming: readonly RosterEntry[],
): boolean {
  const touched = new Set<TradePos>([...out, ...incoming].map((p) => p.position));
  for (const pos of touched) {
    const n = slots[pos] ?? 0;
    if (n === 0) continue;
    const before = (shape.byPos[pos] ?? []).length;
    const after  = before
      - out.filter((p) => p.position === pos).length
      + incoming.filter((p) => p.position === pos).length;
    if (Math.min(after, n) < Math.min(before, n)) return false;
  }
  return true;
}

/** Stable identity of a proposal, for de-duplication. */
function tradeKey(c: TradeCandidate): string {
  const ids = (ps: DepthPlayer[]) => ps.map((p) => p.playerId).sort().join('+');
  return `${c.targetOwnerId}|${ids(c.give)}|${ids(c.receive)}`;
}

/** The shape of an idea — "RB depth for a TE" — regardless of the names in it. */
function tradeShape(c: TradeCandidate): string {
  const pos = (ps: DepthPlayer[]) => [...new Set(ps.map((p) => p.position))].sort().join('+');
  return `${pos(c.give)}>${pos(c.receive)}`;
}

/**
 * Every trade with this partner that leaves both starting lineups better off.
 *
 * Two players a side at most, and never two on both sides at once: it doubles
 * the search for deals that are neither easier to accept nor easier to read.
 */
function tradesWith(
  me:    RosterShape,
  them:  RosterShape,
  slots: Record<string, number>,
): TradeCandidate[] {
  const chips   = tradeChips(me);
  const targets = targetsOn(them, me, slots);
  if (chips.length === 0 || targets.length === 0) return [];

  const myFloor    = me.lineupPts   * MIN_GAIN_SHARE;
  const theirFloor = them.lineupPts * MIN_GAIN_SHARE;

  const out: TradeCandidate[] = [];
  for (const give of singlesAndPairs(chips)) {
    for (const receive of singlesAndPairs(targets)) {
      if (give.length > 1 && receive.length > 1) continue;

      const score = fairness(sumPts(give), sumPts(receive));
      if (score < MIN_FAIRNESS) continue;

      // Neither side may end up unable to field a lineup it fields today.
      if (!keepsLineupFillable(me,   slots, give,    receive)) continue;
      if (!keepsLineupFillable(them, slots, receive, give))    continue;

      // Both deltas, or this is a proposal only one manager would sign.
      const myGain = lineupDelta(me, slots, give, receive);
      if (myGain <= myFloor) continue;
      const theirGain = lineupDelta(them, slots, receive, give);
      if (theirGain <= theirFloor) continue;

      out.push({
        targetOwnerId: them.ownerId,
        give, receive,
        fairnessScore: score,
        myGain, theirGain,
      });
    }
  }
  return out;
}

/**
 * Picks the final set, spreading it across partners, players and ideas.
 *
 * Ranked purely by total gain, the top five come back as the same good player
 * paired with five near-identical partners — the old single-player behaviour
 * arrived at by a better route. So the first pass takes only proposals that
 * introduce a new partner, new players and a new idea, and the passes after it
 * relax those limits in turn to fill the list rather than return three.
 */
function diversify(ranked: readonly TradeCandidate[], limit: number): TradeCandidate[] {
  const picked    = new Map<string, TradeCandidate>();
  const perTeam   = new Map<string, number>();
  const perPlayer = new Map<string, number>();
  const shapes    = new Set<string>();

  const passes: { team: number; player: number; freshShape: boolean }[] = [
    { team: 1,            player: 1,              freshShape: true  },
    { team: MAX_PER_TEAM, player: MAX_PER_PLAYER, freshShape: true  },
    { team: MAX_PER_TEAM, player: MAX_PER_PLAYER, freshShape: false },
  ];

  for (const pass of passes) {
    for (const c of ranked) {
      if (picked.size >= limit) break;

      const key = tradeKey(c);
      if (picked.has(key)) continue;
      if ((perTeam.get(c.targetOwnerId) ?? 0) >= pass.team) continue;

      const players = [...c.give, ...c.receive];
      if (players.some((p) => (perPlayer.get(p.playerId) ?? 0) >= pass.player)) continue;

      const shape = tradeShape(c);
      if (pass.freshShape && shapes.has(shape)) continue;

      picked.set(key, c);
      perTeam.set(c.targetOwnerId, (perTeam.get(c.targetOwnerId) ?? 0) + 1);
      for (const p of players) perPlayer.set(p.playerId, (perPlayer.get(p.playerId) ?? 0) + 1);
      shapes.add(shape);
    }
    if (picked.size >= limit) break;
  }

  return [...picked.values()];
}

/**
 * Best first: the total the deal creates — my gain plus theirs — then fairness,
 * then a stable key so equal proposals do not reorder between requests.
 *
 * The total rather than my side alone, because a proposal the other manager has
 * no reason to accept is not a suggestion.
 */
function byValue(a: TradeCandidate, b: TradeCandidate): number {
  return (b.myGain + b.theirGain) - (a.myGain + a.theirGain)
      || b.fairnessScore - a.fairnessScore
      || tradeKey(a).localeCompare(tradeKey(b));
}

/**
 * Trades worth sending, best first.
 *
 * `diversify` fills the list in passes of loosening constraints, which is not
 * the order anyone wants to read them in, so the chosen set is ranked again on
 * the way out.
 */
export function findTrades(
  me:     RosterShape,
  others: readonly RosterShape[],
  slots:  Record<string, number>,
  limit  = 5,
): TradeCandidate[] {
  const all = others
    .filter((o) => o.ownerId !== me.ownerId)
    .flatMap((o) => tradesWith(me, o, slots));

  all.sort(byValue);
  return diversify(all, limit).sort(byValue);
}

// ─── Wording ──────────────────────────────────────────────────────────────────

/** "RB3", the label that says why this player and not the other one. */
function depthLabel(p: DepthPlayer): string {
  return `${p.position}${p.depthRank}`;
}

/**
 * One line saying which pieces are moving and what the lineup gets for them.
 *
 * It names depth slots rather than positions — "your RB3" is the reason the
 * proposal picked him, and "your RB" is not.
 */
export function describeTrade(candidate: TradeCandidate): string {
  const { give, receive, myGain } = candidate;
  const giveLabel    = give.map(depthLabel).join(' + ');
  const receiveLabel = receive.map(depthLabel).join(' + ');
  const gain         = `+${Math.round(myGain)} pts to your starters`;

  const opening = give.every((p) => !p.starter)
    ? `Spare ${giveLabel} depth`
    : give.length > 1
      ? `Package your ${giveLabel}`
      : `Your ${giveLabel}`;

  return `${opening} for their ${receiveLabel} — ${gain}`;
}
