// src/components/intro/IntroArt.tsx
//
// The little drawings above each slide's title.
//
// They are deliberately literal: the dashboard slides draw the dashboard's own
// tab bar with the tab (or pair of tabs) being explained underlined in #80ff49,
// so the picture and the thing on screen are recognisably the same object.
// Everything is inline SVG in the palette the app already uses — no assets, no
// theme to keep in sync.

'use client';

const INK   = '#e8e6df';
const DIM   = '#3a3a3c';
const FAINT = '#1e1e20';
const LIME  = '#80ff49';

export type DashboardTab = 'matchup' | 'waivers' | 'trades' | 'statistics' | 'news';

/**
 * The dashboard tab bar, with the tabs being explained lit.
 *
 * `active` takes a list because one slide covers two tabs — Statistics and
 * News are a pair — and an empty list is the welcome slide, which is about the
 * bar itself rather than any one tab. Nothing lit means nothing dimmed either:
 * every label reads as ink, so the picture is an overview, not a disabled row.
 *
 * Five tabs where there were three, so the type is a size smaller and the gaps
 * a little tighter — the bar has to reach News without running off the edge.
 */
export function TabBarArt({ active }: { active: DashboardTab | DashboardTab[] }) {
  const lit = Array.isArray(active) ? active : [active];
  const isLit = (id: DashboardTab) => lit.includes(id);
  const overview = lit.length === 0;

  const tabs: { id: DashboardTab; label: string; x: number; w: number }[] = [
    { id: 'matchup',    label: 'Matchup',    x: 24,  w: 47 },
    { id: 'waivers',    label: 'Waivers',    x: 81,  w: 47 },
    { id: 'trades',     label: 'Trades',     x: 138, w: 42 },
    { id: 'statistics', label: 'Statistics', x: 190, w: 64 },
    { id: 'news',       label: 'News',       x: 264, w: 30 },
  ];

  const label = overview
    ? 'The dashboard tab bar'
    : `The ${lit.join(' and ')} ${lit.length > 1 ? 'tabs' : 'tab'} of the dashboard`;

  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img" aria-label={label}>
      <text x="24" y="26" fill={DIM} fontSize="8" letterSpacing="2">LEAGUE PORTAL</text>

      {tabs.map((t) => (
        <g key={t.id}>
          <text x={t.x} y="52" fill={overview || isLit(t.id) ? INK : DIM} fontSize="9.5"
            fontWeight={isLit(t.id) ? 600 : 400}>
            {t.label}
          </text>
          {isLit(t.id) && (
            <rect x={t.x - 4} y="60" width={t.w} height="2" rx="1" fill={LIME} />
          )}
        </g>
      ))}
      <rect x="24" y="61" width="272" height="1" fill={FAINT} />

      <rect x="24" y="74" width="272" height="22" rx="4" fill="#0a0a0b" stroke={FAINT} />
      <rect x="34" y="82" width={isLit('news') ? 90 : 120} height="6" rx="3" fill={DIM} />
      <rect x={isLit('news') ? 132 : 162} y="82" width="34" height="6" rx="3" fill={LIME}
        opacity="0.5" />
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

/**
 * The tier ladder, rarest first.
 *
 * The bar length is how common the tier is, not how good it is — the point of
 * the picture is that the shortest bar is the one worth chasing. Labels sit in
 * their own column to the left so the Hall of Fame bar can be as short as it
 * deserves without cramping its name.
 */
export function TierArt() {
  const tiers = [
    { label: 'Hall of Fame', color: LIME,      bar: 24,  pts: '100' },
    { label: 'Gold',         color: '#e0b64a', bar: 50,  pts: '40'  },
    { label: 'Silver',       color: '#b8bcc4', bar: 94,  pts: '15'  },
    { label: 'Bronze',       color: '#a2683f', bar: 166, pts: '4'   },
  ];
  return (
    <svg viewBox="0 0 320 110" width="100%" height="110" role="img"
      aria-label="Card tiers, from Hall of Fame down to Bronze">
      {tiers.map((t, i) => (
        <g key={t.label} transform={`translate(24 ${14 + i * 22})`}>
          <text x="0" y="11.5" fill={t.color} fontSize="9">{t.label}</text>
          <rect x="76" y="1" width={t.bar} height="14" rx="3"
            fill={`${t.color}22`} stroke={t.color} />
          <text x={82 + t.bar} y="11.5" fill={DIM} fontSize="8">{t.pts} pts</text>
        </g>
      ))}
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
