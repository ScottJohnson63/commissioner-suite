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

/** Widest a tier's bar is drawn, and the narrowest that still reads as a bar. */
const TIER_BAR_MAX = 166;
const TIER_BAR_MIN = 24;

/**
 * The rank band each tier covers, walked in TIER_ORDER.
 *
 * The last tier is open-ended — TIER_MAX_RANK has no entry for Bronze, which is
 * what "everybody else" means — so it is labelled "31+" and drawn full width.
 */
function tierBands() {
  let floor = 1;
  return TIER_ORDER.map((tier) => {
    const max = TIER_MAX_RANK[tier as keyof typeof TIER_MAX_RANK] as number | undefined;
    const band = max === undefined ? `${floor}+` : `${floor}–${max}`;
    const ranks = max === undefined ? null : max - floor + 1;
    floor = (max ?? floor) + 1;
    return { tier, band, ranks };
  });
}

/**
 * The tier ladder, rarest first: what rank band earns each tier, and how wide
 * that band is.
 *
 * As before, the bar length is how common a tier is rather than how good it is,
 * and labels sit in their own column so the short bars are not cramped. What
 * changed is where the length comes from: it is now the width of the tier's
 * rank band, which is what actually decides how much of the pool the tier
 * holds, instead of four numbers chosen by eye.
 *
 * It used to letter each tier with a point value — "Hall of Fame, 100 pts" —
 * directly above the paragraph that says a tier is not itself worth points.
 * Those numbers were invented: nothing in the game scores a card by its tier,
 * and a card scores the points per game on its face whatever tier it is. The
 * picture was teaching the one misconception the slide exists to correct, so it
 * now shows what a tier actually is — a band of season finishes.
 *
 * Hall of Fame and Gold draw the same width, because they cover the same five
 * ranks. That is the honest reading of TIER_MAX_RANK: what separates them is
 * which five, which is what the band label beside each bar says.
 *
 * Bands, labels and widths all come from tiers.ts, so the drawing says the same
 * thing as the rule and keeps saying it when the rule is retuned. See issue #43.
 */
export function TierArt() {
  const bands = tierBands();
  const widest = Math.max(...bands.map((b) => b.ranks ?? 0), 1);
  const barFor = (ranks: number | null) => (
    ranks === null ? TIER_BAR_MAX
      : Math.max(TIER_BAR_MIN, Math.round((ranks / widest) * TIER_BAR_MAX))
  );

  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label="Card tiers, and the season-finish ranks that earn each one">
      {bands.map((b, i) => {
        const color = TIER_COLOR[b.tier];
        const bar = barFor(b.ranks);
        return (
          <g key={b.tier} transform={`translate(24 ${14 + i * 22})`}>
            <text x="0" y="11.5" fill={color} fontSize="9">{TIER_LABEL[b.tier]}</text>
            <rect x="76" y="1" width={bar} height="14" rx="3"
              fill={`${color}22`} stroke={color} />
            <text x={82 + bar} y="11.5" fill={DIM} fontSize="8">{b.band}</text>
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

/**
 * The Commissioner page's tab bar, with one tab lit.
 *
 * Its own art rather than a variant of DeckTabsArt: this is a different page
 * with a different title above the bar, and the point of the slide that uses it
 * is that the controls are somewhere else now.
 */
export function CommissionerTabsArt({ active }: {
  active: 'schedules' | 'divisions' | 'lottery' | 'draft-deck';
}) {
  const tabs = [
    { id: 'schedules'  as const, label: 'Schedules',  x: 24,  w: 62 },
    { id: 'divisions'  as const, label: 'Divisions',  x: 98,  w: 60 },
    { id: 'lottery'    as const, label: 'Lottery',    x: 170, w: 48 },
    { id: 'draft-deck' as const, label: 'Draft Deck', x: 230, w: 66 },
  ];
  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label={`The ${active} tab of the Commissioner page`}>
      <text x="24" y="24" fill={INK} fontSize="12" fontWeight="600">Commissioner</text>

      {tabs.map((t) => (
        <g key={t.id}>
          <text x={t.x} y="52" fill={t.id === active ? INK : DIM} fontSize="11"
            fontWeight={t.id === active ? 600 : 400}>{t.label}</text>
          {t.id === active && <rect x={t.x - 4} y="60" width={t.w} height="2" rx="1" fill={LIME} />}
        </g>
      ))}

      <rect x="24" y="61" width="272" height="1" fill={FAINT} />
      <rect x="24" y="74" width="130" height="24" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="166" y="74" width="130" height="24" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="34" y="83" width="52" height="6" rx="3" fill={LIME} opacity="0.6" />
      <rect x="176" y="83" width="64" height="6" rx="3" fill={DIM} />
    </svg>
  );
}
