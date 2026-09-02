// src/components/cards/tierStyles.ts
//
// What each tier looks like.
//
// Kept apart from the card component so the four designs can be compared side
// by side in one file — the whole point of a tier is that you can tell it at a
// glance across a grid of ninety cards, and that is a decision about four
// palettes together rather than four separate ones.
//
// Every tier gets the same treatment: a metal for the frame, a darker ground
// for the portrait to sit on, and an ink colour with enough contrast to read
// against the frame. Only Hall of Fame adds anything on top, and it earns it by
// being fifteen cards out of eighteen hundred.

import type { CardTier } from '@prisma/client';

export interface TierStyle {
  /** Frame gradient — the metal. */
  frame: string;
  /** Ground behind the portrait. */
  ground: string;
  /** Text on the frame. */
  ink: string;
  /** Rim highlight, also used for the collection's tier headings. */
  edge: string;
  /** Glow cast by the card while it is being revealed. */
  glow: string;
  /** Whether the holographic sweep runs across the card. */
  holo: boolean;
}

export const TIER_STYLE: Record<CardTier, TierStyle> = {
  // Deep violet through magenta into gold: the only tier that is not a single
  // metal, so it never reads as "a slightly better gold".
  HALL_OF_FAME: {
    frame:  'linear-gradient(150deg, #2b1b4d 0%, #6d2b8f 22%, #c2439b 45%, #ffb347 72%, #ffe9a8 100%)',
    ground: 'radial-gradient(ellipse at 50% 32%, #3b2260 0%, #1a1030 62%, #0d0818 100%)',
    ink:    '#fff6da',
    edge:   '#ffcf6b',
    glow:   'rgba(255, 176, 71, 0.55)',
    holo:   true,
  },
  GOLD: {
    frame:  'linear-gradient(150deg, #6b4a12 0%, #c9992f 28%, #f5d571 52%, #b8862a 78%, #7a5615 100%)',
    ground: 'radial-gradient(ellipse at 50% 32%, #3a2c0e 0%, #1d1608 65%, #0f0b04 100%)',
    ink:    '#fff4d2',
    edge:   '#f2cf72',
    glow:   'rgba(242, 207, 114, 0.42)',
    holo:   false,
  },
  SILVER: {
    frame:  'linear-gradient(150deg, #4b5058 0%, #9aa3ad 30%, #dfe5eb 52%, #8d96a1 76%, #565c65 100%)',
    ground: 'radial-gradient(ellipse at 50% 32%, #2b3038 0%, #171a1f 65%, #0c0e11 100%)',
    ink:    '#f2f6fa',
    edge:   '#c8d1da',
    glow:   'rgba(200, 209, 218, 0.34)',
    holo:   false,
  },
  BRONZE: {
    frame:  'linear-gradient(150deg, #4a2c17 0%, #8a552b 30%, #c98a52 54%, #7d4c26 78%, #43270f 100%)',
    ground: 'radial-gradient(ellipse at 50% 32%, #2e1d10 0%, #1a1009 65%, #0d0704 100%)',
    ink:    '#f6e3d0',
    edge:   '#c68f5c',
    glow:   'rgba(198, 143, 92, 0.30)',
    holo:   false,
  },
};

/**
 * The wrapper the sealed pack is drawn in before it is torn open.
 *
 * A pack does not reveal its tier until it is opened, so this is always the
 * same neutral foil — the tier styles above are for what comes out.
 */
export const PACK_FOIL =
  'linear-gradient(155deg, #1c1c20 0%, #2a2a31 30%, #3b3b45 50%, #24242b 72%, #141418 100%)';
