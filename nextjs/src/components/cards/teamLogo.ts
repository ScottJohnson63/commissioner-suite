// src/components/cards/teamLogo.ts
//
// Team logos for the cards that have no photograph.
//
// A team defense has no single face, so its card would otherwise fall back to
// the bare team abbreviation. The logo is the thing that actually identifies a
// defense at a glance across a grid.
//
// ESPN's logo CDN is used because it is already an allowed image host in
// next.config.ts and it covers all 32 teams under nflverse's own abbreviations,
// including the two that usually need remapping: nflverse calls the Rams `LA`
// (not `LAR`) and Washington `WAS` (not `WSH`), and ESPN serves both. Every one
// of the 32 was checked against the live CDN rather than assumed.

/** ESPN's NFL logo CDN, keyed on the lowercased team abbreviation. */
const ESPN_LOGO_BASE = 'https://a.espncdn.com/i/teamlogos/nfl/500';

/**
 * Logo URL for an NFL team abbreviation, or null when there is no team.
 *
 * Returns null rather than a broken URL for free agents and retired players,
 * whose `team` column is empty — the caller falls back to text.
 */
export function teamLogoUrl(team: string | null | undefined): string | null {
  const abbr = team?.trim();
  if (!abbr) return null;
  return `${ESPN_LOGO_BASE}/${abbr.toLowerCase()}.png`;
}
