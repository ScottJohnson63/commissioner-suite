// src/components/intro/IntroArt.tsx
//
// The little drawings above each slide's title.
//
// They are deliberately literal: the dashboard slides draw the dashboard's own
// tab bar with the tab being explained underlined in #80ff49, so the picture
// and the thing on screen are recognisably the same object. Everything is
// inline SVG in the palette the app already uses — no assets, no theme to keep
// in sync.

'use client';

import type { CardTier } from '@prisma/client';
import { TIER_LABEL, TIER_MAX_RANK, TIER_ORDER } from '@/lib/cards/tiers';

const INK   = '#e8e6df';
const DIM   = '#3a3a3c';
const FAINT = '#1e1e20';
const LIME  = '#80ff49';

/** The dashboard tab bar, with one tab lit. */
export function TabBarArt({ active }: { active: 'league' | 'statistics' | 'news' }) {
  const tabs: { id: typeof active; label: string; x: number; w: number }[] = [
    { id: 'league',     label: 'League',     x: 24,  w: 54 },
    { id: 'statistics', label: 'Statistics', x: 90,  w: 74 },
    { id: 'news',       label: 'News',       x: 176, w: 40 },
  ];

  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label={`The ${active} tab of the dashboard`}>
      <text x="24" y="26" fill={DIM} fontSize="8" letterSpacing="2">LEAGUE PORTAL</text>

      {tabs.map((t) => (
        <g key={t.id}>
          <text x={t.x} y="52" fill={t.id === active ? INK : DIM} fontSize="11"
            fontWeight={t.id === active ? 600 : 400}>
            {t.label}
          </text>
          {t.id === active && (
            <rect x={t.x - 4} y="60" width={t.w} height="2" rx="1" fill={LIME} />
          )}
        </g>
      ))}
      <rect x="24" y="61" width="272" height="1" fill={FAINT} />

      <rect x="24" y="74" width="272" height="22" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="34" y="82" width={active === 'news' ? 90 : 120} height="6" rx="3" fill={DIM} />
      <rect x={active === 'news' ? 132 : 162} y="82" width="34" height="6" rx="3" fill={LIME}
        opacity="0.5" />
    </svg>
  );
}

/** A sidebar with Draft Deck lit — the slide that hands you off to the game. */
export function SidebarArt() {
  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label="The Draft Deck link in the sidebar">
      <rect x="60" y="10" width="90" height="90" rx="6" fill="#0a0a0b" stroke={FAINT} />
      <rect x="70" y="22" width="46" height="5" rx="2.5" fill={DIM} />
      <rect x="70" y="42" width="40" height="5" rx="2.5" fill={DIM} />
      <rect x="70" y="58" width="50" height="5" rx="2.5" fill={DIM} />
      <rect x="66" y="70" width="78" height="18" rx="4" fill="rgba(128,255,73,0.1)" />
      <rect x="72" y="76" width="6" height="6" rx="1.5" fill={LIME} />
      <rect x="84" y="77" width="52" height="5" rx="2.5" fill={LIME} />

      <path d="M158 79h26" stroke={LIME} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M180 75l5 4-5 4" stroke={LIME} strokeWidth="1.5" strokeLinecap="round"
        strokeLinejoin="round" fill="none" />

      <CardFan x={196} />
    </svg>
  );
}

/** Three cards, fanned. Reused by the Draft Deck tour's opening slide. */
export function CardFan({ x = 110 }: { x?: number }) {
  return (
    <g transform={`translate(${x} 18)`}>
      <rect x="0" y="14" width="40" height="56" rx="5" fill="#0a0a0b" stroke={DIM}
        transform="rotate(-12 20 42)" />
      <rect x="34" y="10" width="40" height="56" rx="5" fill="#0a0a0b" stroke="#6a5a2a" />
      <rect x="68" y="14" width="40" height="56" rx="5" fill="#0a0a0b" stroke={LIME}
        transform="rotate(12 88 42)" />
      <circle cx="54" cy="28" r="8" fill={FAINT} />
      <rect x="42" y="42" width="24" height="4" rx="2" fill={DIM} />
      <rect x="46" y="50" width="16" height="4" rx="2" fill="#6a5a2a" />
    </g>
  );
}

export function CardsArt() {
  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img" aria-label="A fan of player cards">
      <CardFan x={106} />
    </svg>
  );
}

/** One colour per tier, matching the cards and the deck's tier tiles. */
const TIER_COLOR: Record<CardTier, string> = {
  HALL_OF_FAME: LIME,
  GOLD:         '#e0b64a',
  SILVER:       '#b8bcc4',
  BRONZE:       '#a2683f',
};

/** The rank track: where it starts, how wide, and the share the ranked bands use. */
const TRACK_X = 60;
const TRACK_W = 252;
const RANKED_SHARE = 0.78;
/** Narrowest a block may be drawn and still hold its range label. */
const BLOCK_MIN = 32;

/**
 * The rank band each tier covers, walked in TIER_ORDER.
 *
 * The last tier is open-ended — TIER_MAX_RANK has no entry for Bronze, which is
 * what "everyone else" means — so it is labelled from its first rank up and
 * runs to the end of the track.
 */
function tierBands() {
  let first = 1;
  return TIER_ORDER.map((tier) => {
    const max = TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK] as number | undefined;
    const band = { tier, first, max, label: max === undefined ? `${first}+` : `${first}–${max}` };
    if (max !== undefined) first = max + 1;
    return band;
  });
}

/**
 * The tier ladder as a rank axis: each tier's block sits where its band falls.
 *
 * Rarest first, and offset — Hall of Fame starts at the left because it starts
 * at rank 1, and every tier below begins where the one above it ended. That
 * staircase is the point of the picture: the tiers are consecutive slices of
 * one ranking, not four separate awards. The range sits inside its own block,
 * in the tier's colour and bold, so the number and the thing it describes are
 * the same object.
 *
 * It used to letter each tier with a point value — "Hall of Fame, 100 pts" —
 * directly above the paragraph saying a tier is not itself worth points. Those
 * numbers were invented: nothing in the game scores a card by its tier.
 *
 * Bands, widths and labels all come from TIER_MAX_RANK, so the drawing says the
 * same thing as the rule and keeps saying it when the rule is retuned. Blocks
 * are floored at BLOCK_MIN so a narrow band still fits its label; the ranked
 * bands share RANKED_SHARE of the track and the open-ended tier takes the rest.
 */
export function TierArt() {
  const bands = tierBands();
  const lastRanked = Math.max(...bands.map((b) => b.max ?? 0), 1);
  const perRank = (TRACK_W * RANKED_SHARE) / lastRanked;
  const startX = (first: number) => TRACK_X + (first - 1) * perRank;
  const open = bands.find((b) => b.max === undefined);

  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label="Card tiers, and the season-finish ranks that earn each one">
      {/* The open-ended tier's block dissolves at the right rather than ending
          in a border. A rank axis has to stop somewhere and that tier does not,
          so a hard right edge would draw it as the narrowest band on the chart
          when it is the one that holds most of the pool. */}
      {open && (
        <defs>
          <linearGradient id="ut-tier-open-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0.45" stopColor={TIER_COLOR[open.tier]} stopOpacity="0.13" />
            <stop offset="1" stopColor={TIER_COLOR[open.tier]} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ut-tier-open-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0.45" stopColor={TIER_COLOR[open.tier]} stopOpacity="1" />
            <stop offset="1" stopColor={TIER_COLOR[open.tier]} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {bands.map((b, i) => {
        const color = TIER_COLOR[b.tier];
        const isOpen = b.max === undefined;
        const x = startX(b.first);
        const width = isOpen
          ? Math.max(BLOCK_MIN, TRACK_X + TRACK_W - x)
          : Math.max(BLOCK_MIN, (b.max! - b.first + 1) * perRank);
        // The open block's label sits over its solid end, not the middle of a
        // shape whose right half has faded out.
        const labelX = isOpen ? x + Math.min(width, BLOCK_MIN) / 2 + 4 : x + width / 2;
        return (
          <g key={b.tier} transform={`translate(8 ${14 + i * 22})`}>
            <text x="0" y="11.5" fill={color} fontSize="9">{TIER_LABEL[b.tier]}</text>
            <rect x={x} y="1" width={width} height="14" rx="3"
              fill={isOpen ? 'url(#ut-tier-open-fill)' : `${color}22`}
              stroke={isOpen ? 'url(#ut-tier-open-stroke)' : color} />
            <text x={labelX} y="11.5" fill={color} fontSize="9" fontWeight="700"
              textAnchor="middle">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function WildCardArt() {
  // The pips of a six, as unit offsets within the die's face.
  const six = [
    [-1, -1], [-1, 0], [-1, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label="A pack, the wildcard die it can hide, and the packs it pays out">
      {/* The pack. */}
      <g>
        <rect x="40" y="26" width="52" height="62" rx="5" fill="#0a0a0b" stroke={LIME} />
        <rect x="48" y="36" width="36" height="6" rx="3" fill={LIME} opacity="0.55" />
        <rect x="48" y="48" width="26" height="5" rx="2.5" fill={DIM} />
        <text x="66" y="76" fill={LIME} fontSize="9" fontWeight="700" textAnchor="middle">
          PACK
        </text>
      </g>

      <g stroke={DIM} strokeWidth="1.4" fill="none">
        <path d="M106 57h34" />
        <path d="M134 51l6 6-6 6" />
      </g>

      {/* The die, showing its best face. */}
      <g>
        <rect x="154" y="28" width="58" height="58" rx="10" fill="#0a0a0b" stroke={LIME} />
        {six.map(([dx, dy]) => (
          <circle key={`${dx},${dy}`} cx={183 + dx * 14} cy={57 + dy * 16} r="3.6" fill={LIME} />
        ))}
      </g>

      <g stroke={DIM} strokeWidth="1.4" fill="none">
        <path d="M226 57h34" />
        <path d="M254 51l6 6-6 6" />
      </g>

      <text x="288" y="53" fill={INK} fontSize="12" fontWeight="700" textAnchor="middle">
        1–6
      </text>
      <text x="288" y="67" fill={DIM} fontSize="8" textAnchor="middle">
        packs
      </text>
    </svg>
  );
}

/**
 * The three numbers on a card face, circled and numbered.
 *
 * A demo card rather than the real PlayerCard: this is a diagram, and it has to
 * hold callout rings and lead lines that the component has no business knowing
 * about. It mirrors the real face's arrangement — the PPG block and the season
 * down the top-left, the finish in the top-right — so a member can find the
 * same three numbers on their own cards.
 *
 * Taller than the other art, because a card is 2:3 and a legible one does not
 * fit in a 110px band.
 *
 * The badge numbers come from CARD_DETAIL_CALLOUTS' order, and the slide builds
 * its bullets from the same array, so the ring labelled 2 and the bullet
 * labelled 2 cannot come to mean different things.
 */
export const CARD_DETAIL_CALLOUTS = [
  "Player's average Points Per Game that year",
  "The year associated with the card's PPG",
  "Player's rank in his position",
] as const;

/** Where each callout's ring sits, and which side its badge hangs off. */
const CARD_DETAIL_MARKS = [
  // Ring 1 takes in the "PPG" caption as well as the number, because the
  // caption is what tells you the number is an average.
  { cx: 133, cy: 40, rx: 30, ry: 18, badgeX: 52,  from: 'left'  as const },
  { cx: 118, cy: 76, rx: 17, ry: 9,  badgeX: 52,  from: 'left'  as const },
  { cx: 202, cy: 36, rx: 16, ry: 12, badgeX: 274, from: 'right' as const },
];

export function CardDetailArt() {
  const GOLD = '#e0b64a';

  return (
    <svg viewBox="0 0 320 220" width="100%" height="220" role="img"
      aria-label="A card face with its points per game, season and rank circled">
      {/* ── The card ── */}
      <rect x="95" y="12" width="130" height="195" rx="9" fill="#111112" stroke={GOLD} />
      <rect x="99" y="16" width="122" height="187" rx="7" fill="#0a0a0b" />

      {/* Top-left block: the headline number, then who and when. */}
      <text x="107" y="42" fill={GOLD} fontSize="19" fontWeight="800">18.4</text>
      <text x="108" y="51" fill={GOLD} fontSize="6" fontWeight="700" opacity="0.75">PPG</text>
      <text x="107" y="64" fill={GOLD} fontSize="7.5" fontWeight="700">WR</text>
      <text x="107" y="78" fill={GOLD} fontSize="7" opacity="0.7">2025</text>

      {/* Top-right: where he finished at his position. */}
      <text x="215" y="42" fill={GOLD} fontSize="13" fontWeight="800" textAnchor="end"
        opacity="0.6">#7</text>

      {/* Portrait, as a silhouette. */}
      <circle cx="160" cy="119" r="20" fill={GOLD} opacity="0.18" />
      <path d="M124 172c0-20 16-33 36-33s36 13 36 33z" fill={GOLD} opacity="0.18" />

      {/* Name band. */}
      <rect x="99" y="176" width="122" height="27" fill="#000" opacity="0.55" />
      <rect x="126" y="183" width="68" height="7" rx="3.5" fill={GOLD} opacity="0.55" />
      <rect x="146" y="195" width="28" height="5" rx="2.5" fill={DIM} />

      {/* ── Callouts ── */}
      {CARD_DETAIL_MARKS.map((m, i) => {
        const edge = m.from === 'left' ? m.cx - m.rx : m.cx + m.rx;
        const badgeEdge = m.from === 'left' ? m.badgeX + 9 : m.badgeX - 9;
        return (
          <g key={i}>
            <ellipse cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry}
              fill="none" stroke={LIME} strokeWidth="1.6" />
            <line x1={badgeEdge} y1={m.cy} x2={edge} y2={m.cy}
              stroke={LIME} strokeWidth="1.2" opacity="0.55" />
            <circle cx={m.badgeX} cy={m.cy} r="9" fill={LIME} />
            <text x={m.badgeX} y={m.cy + 3.5} fill="#0a0a0b" fontSize="10" fontWeight="800"
              textAnchor="middle">{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The Draft Deck tab bar, with one tab lit. */
export function DeckTabsArt({ active }: {
  active: 'packs' | 'deck' | 'lineup';
}) {
  const tabs = [
    { id: 'packs'  as const, label: 'Packs',  x: 24,  w: 44 },
    { id: 'deck'   as const, label: 'Deck',   x: 80,  w: 38 },
    { id: 'lineup' as const, label: 'Lineup', x: 130, w: 48 },
  ];
  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label={`The ${active} tab of Draft Deck`}>
      <text x="24" y="24" fill={INK} fontSize="12" fontWeight="600">Draft Deck</text>

      {tabs.map((t) => (
        <g key={t.id}>
          <text x={t.x} y="52" fill={t.id === active ? INK : DIM} fontSize="11"
            fontWeight={t.id === active ? 600 : 400}>{t.label}</text>
          {t.id === active && <rect x={t.x - 4} y="60" width={t.w} height="2" rx="1" fill={LIME} />}
        </g>
      ))}

      <rect x="24" y="61" width="272" height="1" fill={FAINT} />
      <rect x="24" y="74" width="84" height="24" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="118" y="74" width="84" height="24" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="212" y="74" width="84" height="24" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="32" y="83" width="30" height="6" rx="3" fill={LIME} opacity="0.6" />
      <rect x="126" y="83" width="44" height="6" rx="3" fill={DIM} />
      <rect x="220" y="83" width="38" height="6" rx="3" fill={DIM} />
    </svg>
  );
}
