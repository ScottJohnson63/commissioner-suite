/**
 * The NflWeeklyStat columns fantasy scoring reads.
 *
 * Deliberately a structural subset rather than the Prisma row type: callers
 * select only the columns they need, and a scoring function should accept any
 * projection that carries them. Every field is nullable because the table is
 * sparse — a receiver has no kicking columns, and rows written before a sync
 * gained a column keep nulls there.
 */
export interface StatLine {
  /** QB | RB | WR | TE | K | DEF — decides which scoring rules apply. */
  position:         string | null;

  // ── Skill positions ─────────────────────────────────────────────────
  /** nflverse's standard (non-PPR) total. Receptions are added per league. */
  fantasyPoints:    number | null;
  receptions:       number | null;

  // ── Kicking ─────────────────────────────────────────────────────────
  fgMade?:          number | null;
  fgMissed?:        number | null;
  fgMade0To19?:     number | null;
  fgMade20To29?:    number | null;
  fgMade30To39?:    number | null;
  fgMade40To49?:    number | null;
  fgMade50To59?:    number | null;
  fgMade60Plus?:    number | null;
  fgMissed0To19?:   number | null;
  fgMissed20To29?:  number | null;
  fgMissed30To39?:  number | null;
  fgMissed40To49?:  number | null;
  fgMissed50To59?:  number | null;
  fgMissed60Plus?:  number | null;
  patMade?:         number | null;
  patMissed?:       number | null;

  // ── Team defense ────────────────────────────────────────────────────
  defSacks?:         number | null;
  defInterceptions?: number | null;
  defFumblesForced?: number | null;
  /** Fumbles recovered by this defense. */
  defFumbles?:       number | null;
  defTds?:           number | null;
  defSafeties?:      number | null;
  defPuntBlocks?:    number | null;
  defPatBlocks?:     number | null;
  defFgBlocks?:      number | null;
  /** Points this defense's team conceded. Null on rows the defense sync has not written. */
  pointsAllowed?:    number | null;
  /** Offensive yards this defense conceded. Null as above. */
  yardsAllowed?:     number | null;
}
