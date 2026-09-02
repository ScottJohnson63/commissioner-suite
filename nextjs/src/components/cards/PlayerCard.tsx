'use client';

// src/components/cards/PlayerCard.tsx
//
// One collectible card.
//
// Laid out the way a trading card is: the number that matters in the top-left
// corner, the player filling the middle, and the name across a band at the
// bottom. Everything is sized in `em` against a root font-size derived from the
// card's width, so the same component renders as a 96px thumbnail in the
// collection grid and a 300px hero in the pack opener with no second layout.

import Image from 'next/image';
import { useState } from 'react';
import type { CardTier } from '@prisma/client';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import { TIER_LABEL } from '@/lib/cards/tiers';
import { teamLogoUrl } from '@/components/cards/teamLogo';

export interface PlayerCardData {
  id: string;
  season: number;
  playerName: string;
  position: string;
  team: string | null;
  tier: CardTier;
  seasonRank: number;
  fantasyPoints: number;
  /** PPR points per game — the headline number on the card. */
  pointsPerGame: number;
  gamesPlayed: number;
  /** Number worn that season, or null for defenses and missing roster rows. */
  jerseyNumber: number | null;
  headshot: string | null;
  /**
   * What the owner calls this card, shown in place of the player's name.
   *
   * Optional because the pack opener renders pool cards, which have no owner
   * yet and so cannot have been named.
   */
  nickname?: string | null;
  /** An owner-supplied portrait, shown in place of the pool's own. */
  customImage?: string | null;
}

/**
 * The portrait, or a fallback for cards that have no photograph.
 *
 * Team defenses never have one — there is no single face for a defense — and a
 * handful of skill players are missing theirs upstream. Both land on the team
 * abbreviation set in the tier's own ink, which reads as deliberate rather than
 * as a broken image.
 */
function Portrait({
  card, src, style, onError,
}: {
  card: PlayerCardData;
  /** Already resolved by the caller — an owner's upload wins over the pool's. */
  src: string;
  style: { ink: string };
  onError: () => void;
}) {
  // A local preview is a blob: URL and a stored upload is served from this
  // app's own route; next/image handles neither well — it refuses blob: and
  // data:, and there is nothing for it to optimise on a route that already
  // returns exactly the bytes asked for. Both render as a plain img. Remote
  // portraits keep going through next/image for its sizing and lazy-loading.
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/api/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={card.nickname || card.playerName}
        className="absolute inset-0 w-full h-full object-cover object-top"
        style={{ color: style.ink }}
        onError={onError}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={card.playerName}
      fill
      // The card is at most ~320px wide anywhere it is used; asking for a
      // narrow source keeps the pack reveal from pulling five full-size images.
      sizes="320px"
      // Cover rather than contain: nflverse headshots are wide (roughly 3400 x
      // 2450) with the player centred, so containing them inside a 2:3 card
      // leaves the portrait occupying about two-thirds of the height and the
      // card looking empty. Covering crops the empty sides instead, which is
      // what makes the player fill the frame.
      className="object-cover object-top"
      style={{ color: style.ink }}
      onError={onError}
      unoptimized
    />
  );
}

/**
 * What stands in for a photograph: the team's logo, or its abbreviation.
 *
 * Team defenses always land here — there is no one face for a defense — and so
 * do the handful of skill players missing a headshot upstream. The logo is what
 * makes a defense card identifiable in a grid; the lettering is the last
 * resort, for a free agent whose `team` is empty or a logo that fails to load.
 */
function PortraitFallback({ card, ink }: { card: PlayerCardData; ink: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = teamLogoUrl(card.team);

  if (logo && !logoFailed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '0.75em' }}>
        <div className="relative w-full h-full">
          <Image
            src={logo}
            alt={`${card.team} logo`}
            fill
            sizes="320px"
            className="object-contain"
            onError={() => setLogoFailed(true)}
            unoptimized
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span
        className="font-black tracking-tight"
        style={{ fontSize: '2.6em', color: ink, opacity: 0.22, lineHeight: 1 }}
      >
        {card.team ?? card.position}
      </span>
    </div>
  );
}

export function PlayerCard({
  card, width = 180, showTierName = false, className = '', style: outerStyle,
}: {
  card: PlayerCardData;
  /** Card width in px. Everything else scales from this. */
  width?: number;
  /** Print the tier's name along the bottom edge. Used in the reveal. */
  showTierName?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const tier = TIER_STYLE[card.tier];

  // An owner's upload wins over the pool's portrait. This is also what makes a
  // customized card worth having for the 800-odd players with no photograph
  // anywhere: uploading one is the only way that card ever gets a face.
  const portrait = card.customImage || card.headshot;

  // One em is a twelfth of the card's width, which keeps every rule below
  // resolution-independent — see the note at the top of the file.
  const em = width / 12;
  const hasImage = Boolean(portrait) && !imageFailed;

  return (
    <div
      className={`relative select-none ${className}`}
      style={{
        width,
        aspectRatio: '2 / 3',
        fontSize: em,
        borderRadius: '0.6em',
        padding: '0.16em',
        background: tier.frame,
        boxShadow: `0 0.3em 1.2em -0.2em ${tier.glow}, 0 0 0 1px rgba(0,0,0,0.5)`,
        ...outerStyle,
      }}
    >
      {/* Prismatic drift, Hall of Fame only. Sits on the frame, under the face. */}
      {tier.holo && (
        <div
          className="ut-prism absolute inset-0 pointer-events-none"
          style={{
            borderRadius: '0.6em',
            background: tier.frame,
            animation: 'ut-prism 6s ease-in-out infinite',
          }}
        />
      )}

      {/* ── Card face ── */}
      <div
        className="relative w-full h-full overflow-hidden flex flex-col"
        style={{ borderRadius: '0.48em', background: tier.ground }}
      >
        {/* Holographic sweep, Hall of Fame only. */}
        {tier.holo && (
          <div
            className="ut-holo absolute pointer-events-none z-20"
            style={{
              top: 0, bottom: 0, width: '38%',
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.34), transparent)',
              animation: 'ut-holo 3.4s ease-in-out infinite',
            }}
          />
        )}

        {/* ── Corner block: PPR points per game, then who and when ──
            Per game rather than the season total, so a card says how good the
            player was rather than how long he stayed fit. This is also the
            number the tier is set by, so the headline and the frame always
            agree — see rankSeason in lib/cards/pool.ts. */}
        <div
          className="absolute z-10 flex flex-col items-center"
          style={{ top: '0.5em', left: '0.55em', lineHeight: 1 }}
        >
          <span
            className="font-black"
            style={{ fontSize: '1.45em', color: tier.ink, letterSpacing: '-0.03em' }}
          >
            {card.pointsPerGame.toFixed(1)}
          </span>
          <span
            className="font-bold"
            style={{ fontSize: '0.5em', color: tier.edge, letterSpacing: '0.1em' }}
          >
            PPG
          </span>
          <span
            className="font-bold"
            style={{
              fontSize: '0.58em', color: tier.ink,
              letterSpacing: '0.08em', marginTop: '0.3em',
            }}
          >
            {card.position}
          </span>
          <span
            style={{
              fontSize: '0.5em', color: tier.ink, opacity: 0.65,
              letterSpacing: '0.06em', marginTop: '0.25em',
            }}
          >
            {card.season}
          </span>
        </div>

        {/* Jersey number worn that season, top-right. Defenses have none, and
            neither does a player whose roster row is missing, so the slot is
            simply left empty rather than filled with a placeholder. */}
        {card.jerseyNumber != null && (
          <div
            className="absolute z-10 font-black"
            style={{
              top: '0.45em', right: '0.55em', fontSize: '0.95em',
              color: tier.ink, opacity: 0.5, letterSpacing: '-0.04em',
            }}
          >
            {card.jerseyNumber}
          </div>
        )}

        {/* ── Portrait ── */}
        <div className="relative flex-1 overflow-hidden" style={{ marginTop: '1.15em' }}>
          {hasImage ? (
            <Portrait
              card={card}
              src={portrait!}
              style={{ ink: tier.ink }}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <PortraitFallback card={card} ink={tier.ink} />
          )}
        </div>

        {/* ── Name band ── */}
        <div
          className="relative z-10 text-center"
          style={{
            padding: '0.34em 0.3em 0.5em',
            background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.72) 42%)',
          }}
        >
          <div
            className="font-bold uppercase truncate"
            style={{ fontSize: '0.72em', color: tier.ink, letterSpacing: '0.02em' }}
          >
            {/* The nickname replaces the name rather than sitting beside it.
                A card someone has named is theirs, and printing both would
                make the rename look like an annotation on somebody else's
                card. The real name is still on the detail view. */}
            {card.nickname || card.playerName}
          </div>
          <div
            className="truncate"
            style={{
              fontSize: '0.5em', color: tier.edge,
              letterSpacing: '0.14em', marginTop: '0.2em', opacity: 0.85,
            }}
          >
            {showTierName ? TIER_LABEL[card.tier].toUpperCase() : (card.team ?? '—')}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The back of a card.
 *
 * Pass a `tier` and the back is drawn in that tier's metal: you can see a Hall
 * of Fame card coming before you turn it over, without knowing who it is. That
 * tease is the whole point of the reveal — the colour is the promise and the
 * flip is the payoff.
 *
 * Left neutral when no tier is given, for the plain back used elsewhere.
 */
export function CardBack({
  width = 180, tier, className = '',
}: { width?: number; tier?: CardTier; className?: string }) {
  const em = width / 12;
  const style = tier ? TIER_STYLE[tier] : null;

  return (
    <div
      className={`relative ${className}`}
      style={{
        width, aspectRatio: '2 / 3', fontSize: em,
        borderRadius: '0.6em', padding: '0.16em',
        background: style?.frame ?? 'linear-gradient(150deg, #26262c, #3a3a44 45%, #1b1b20)',
        boxShadow: style
          ? `0 0.3em 1.2em -0.2em ${style.glow}, 0 0 0 1px rgba(0,0,0,0.5)`
          : '0 0.3em 1em -0.2em rgba(0,0,0,0.8)',
      }}
    >
      {/* The Hall of Fame back drifts like its face does, so the rarest pull
          announces itself before it is turned. */}
      {style?.holo && (
        <div
          className="ut-prism absolute inset-0 pointer-events-none"
          style={{
            borderRadius: '0.6em', background: style.frame,
            animation: 'ut-prism 6s ease-in-out infinite',
          }}
        />
      )}

      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        style={{
          borderRadius: '0.48em',
          background: style?.ground ?? 'radial-gradient(ellipse at 50% 40%, #23232a, #101014)',
        }}
      >
        {style?.holo && (
          <div
            className="ut-holo absolute"
            style={{
              top: 0, bottom: 0, width: '38%',
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              animation: 'ut-holo 3.4s ease-in-out infinite',
            }}
          />
        )}
        <span
          className="relative font-black"
          style={{
            fontSize: '1.4em',
            color: style?.edge ?? '#4a4a55',
            letterSpacing: '-0.04em',
            opacity: style ? 0.55 : 1,
          }}
        >
          CS
        </span>
      </div>
    </div>
  );
}
