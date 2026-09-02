'use client';

// src/components/cards/CardDetail.tsx
//
// The selected card, large, with the things you can do to it.
//
// The deck used to be a grid and nothing else: a few hundred 104px cards you
// could look at and not touch. Everything a member might want to *do* with a
// card — name it, give it a face, put it in the lineup — had no home, because
// there was nowhere on the page that was about one card.
//
// So this is that place. It holds the selection, and the grid below it becomes
// a picker. The card renders at 260px because the portrait is the point: an
// upload is worth making at a size where you can see it.
//
// Nickname and image are one form with one save, matching the route behind it
// — the reward is paid when a card has both, and two separate saves would let
// a member complete a card without the UI ever telling them they had.

import { useRef, useState } from 'react';
import { PlayerCard } from '@/components/cards/PlayerCard';
import { TIER_STYLE } from '@/components/cards/tierStyles';
import { TIER_LABEL } from '@/lib/cards/tiers';
import { MAX_NICKNAME_LENGTH } from '@/lib/cards/customize';
import type { CustomizeResponse, OwnedCardDto, RosterSlotDto } from '@/types/cards';

/**
 * Longest edge of an uploaded portrait, in px.
 *
 * The card renders at most ~320px wide, so 640 covers a high-DPI screen with
 * room to spare. Downscaling in the browser rather than on the server is what
 * keeps a 6 MB phone photo under the route's 256 KB cap without the server ever
 * having to buffer the 6 MB — and the app has no image library on the server to
 * do it with anyway.
 */
const MAX_UPLOAD_EDGE = 640;

/** JPEG quality for the downscale. 0.82 is the usual "no visible loss" point. */
const UPLOAD_QUALITY = 0.82;

/**
 * Reads a file, downscales it, and returns it as a JPEG blob.
 *
 * Canvas rather than a library: this is the one image operation the app does,
 * and every browser it runs in has it built in. A photo that is already small
 * is still re-encoded, which costs nothing and means the size cap is enforced
 * on one predictable format instead of on whatever came off the camera.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not read that image');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', UPLOAD_QUALITY),
  );
  if (!blob) throw new Error('Could not read that image');
  return blob;
}

export function CardDetail({
  card, roster, onSave, onAssign, busySlot, rewardsRemaining, onSaved,
}: {
  card: OwnedCardDto | null;
  roster: RosterSlotDto[];
  onSave: (cardId: string, nickname: string, image: Blob | null) => Promise<CustomizeResponse>;
  onAssign: (slotId: string, cardId: string | null) => Promise<void>;
  busySlot: string | null;
  /** Cards that can still earn a pack, for the hint under the save button. */
  rewardsRemaining: number;
  /**
   * Called once the Save button's write has landed. The caller in a dialog —
   * currently the only one — uses this to close it: a member who tapped Save
   * is done with the card, and the confirmation is worth a beat but not a
   * second tap to dismiss.
   */
  onSaved?: () => void;
}) {
  // Initialised from the card rather than reset by an effect: the caller keys
  // this component on the selected id, so picking a different card remounts it
  // and a half-typed nickname cannot follow the user onto the next card.
  const [nickname, setNickname] = useState(card?.nickname ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!card) {
    return (
      <div
        className="rounded p-10 text-center text-xs"
        style={{ background: '#0e0e0f', border: '1px solid #1e1e20', color: '#555' }}
      >
        Pick a card below to name it, give it a face, or put it in your lineup.
      </div>
    );
  }

  const tier = TIER_STYLE[card.tier];
  // Slots this player is actually eligible for — the same rule the route
  // enforces, so the buttons offered are the ones that will be accepted.
  const eligible = roster.filter((slot) => slot.accepts.includes(card.position));
  const startedIn = roster.find((slot) => slot.card?.id === card.id);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await downscale(file);
      setPending(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image');
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await onSave(card.id, nickname, pending);
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
      setMessage(
        result.packsAwarded > 0
          ? `Saved — ${result.packsAwarded} pack earned. This portrait is permanent ` +
            'and stays with the card after the season resets.'
          : result.eligibleForReward
            ? 'Saved. Upload a picture for this card to earn a pack.'
            : 'Saved.',
      );
      // Only on a successful write — a failed save leaves the dialog open on
      // the error, since that is the one moment the member still needs it.
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  // The card as it would look once saved, so the preview is the card itself
  // rather than a thumbnail beside it.
  const previewCard: OwnedCardDto = {
    ...card,
    nickname: nickname.trim() || null,
    customImage: preview ?? card.customImage,
  };

  // Only a card with no face at all pays a pack, and only for the picture —
  // the nickname is free. Saying so up front is the difference between a rule
  // and a disappointment. See MAX_CUSTOMIZATION_PACKS.
  const canEarn = card.eligibleForReward && rewardsRemaining > 0;

  const dirty =
    pending !== null || (nickname.trim() || null) !== (card.nickname ?? null);

  return (
    <div
      className="rounded p-5 flex flex-col sm:flex-row gap-6"
      style={{ background: '#0e0e0f', border: `1px solid ${tier.edge}44` }}
    >
      {/* ── The card, big ── */}
      <div className="flex flex-col items-center gap-3 shrink-0 mx-auto sm:mx-0">
        <PlayerCard card={previewCard} width={260} showTierName />
        <div className="text-[10px] text-center" style={{ color: '#555' }}>
          {/* The real name lives here once a nickname has replaced it on the
              face, so renaming a card never loses track of who it is. */}
          {previewCard.nickname ? `${card.playerName} · ` : ''}
          {card.position} · {card.season} · {TIER_LABEL[card.tier]} #{card.seasonRank}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div>
          <label
            htmlFor="card-nickname"
            className="text-[10px] uppercase block mb-1.5"
            style={{ letterSpacing: '0.14em', color: '#666' }}
          >
            Nickname
          </label>
          <input
            id="card-nickname"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={card.playerName}
            className="w-full text-sm rounded px-3 py-2"
            style={{ background: '#141416', border: '1px solid #1e1e20', color: '#e8e6df' }}
          />
        </div>

        <div>
          <label
            htmlFor="card-image"
            className="text-[10px] uppercase block mb-1.5"
            style={{ letterSpacing: '0.14em', color: '#666' }}
          >
            Picture
          </label>
          <input
            id="card-image"
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="w-full text-[11px]"
            style={{ color: '#888' }}
          />
          <p className="text-[10px] mt-1" style={{ color: '#444' }}>
            Resized in your browser before it is sent. JPEG, PNG or WebP.
            {canEarn && ' This card has no photo, so yours is kept permanently.'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="px-4 py-2 text-xs font-medium rounded transition-opacity"
            style={{
              background: dirty ? '#80ff49' : '#1e1e20',
              color: dirty ? '#0a0a0b' : '#555',
              opacity: saving ? 0.5 : 1,
              cursor: saving || !dirty ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {card.customImage && (
            <button
              onClick={() => void onSave(card.id, nickname, null).then(() => setPreview(null))}
              className="text-[11px] underline"
              style={{ color: '#666' }}
            >
              Remove picture
            </button>
          )}

          <span
            className="text-[10px] ml-auto text-right"
            style={{ color: canEarn ? '#80ff49' : '#444' }}
          >
            {card.isContributed
              ? 'Portrait contributed — kept after the season resets'
              : !card.eligibleForReward
                ? 'Already has a photo — a new one earns no pack and resets'
                : rewardsRemaining === 0
                  ? 'Pack rewards used up for this season'
                  : `No photo exists — upload one for a pack (${rewardsRemaining} left)`}
          </span>
        </div>

        {message && <p className="text-[11px]" style={{ color: '#80ff49' }}>{message}</p>}
        {error && <p className="text-[11px]" style={{ color: '#ff6b6b' }}>{error}</p>}

        {/* ── Lineup ── */}
        <div className="pt-3 mt-1" style={{ borderTop: '1px solid #1e1e20' }}>
          <div
            className="text-[10px] uppercase mb-2"
            style={{ letterSpacing: '0.14em', color: '#666' }}
          >
            Lineup
          </div>
          {startedIn ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px]" style={{ color: '#80ff49' }}>
                Starting at {startedIn.label}
              </span>
              <button
                onClick={() => void onAssign(startedIn.id, null)}
                disabled={busySlot === startedIn.id}
                className="text-[11px] underline"
                style={{ color: '#666' }}
              >
                Bench
              </button>
            </div>
          ) : eligible.length === 0 ? (
            <p className="text-[11px]" style={{ color: '#555' }}>
              No slot in the lineup takes a {card.position}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {eligible.map((slot) => (
                <button
                  key={slot.id}
                  onClick={() => void onAssign(slot.id, card.id)}
                  disabled={busySlot === slot.id}
                  className="px-2.5 py-1.5 text-[11px] rounded transition-colors"
                  style={{
                    background: '#141416',
                    border: '1px solid #1e1e20',
                    color: busySlot === slot.id ? '#444' : '#bdbcb4',
                  }}
                >
                  {/* Naming what is there makes the swap explicit rather than
                      something the member discovers after the fact. */}
                  {slot.label}
                  {slot.card && (
                    <span style={{ color: '#555' }}>
                      {' '}· replaces {slot.card.playerName.split(' ').slice(-1)[0]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
