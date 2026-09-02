// src/app/api/cards/image/route.ts
//
// POST — make a card yours: give it a nickname, a portrait, or both.
//
// Named for the upload because that is the part with real handling behind it,
// but it takes the nickname too, and deliberately: the reward is paid when a
// card has *both*, so splitting the two across separate routes would mean
// either duplicating the award logic or racing it. One route, one write, one
// decision about whether that write completed the card.
//
// Two body shapes, because the two callers want different things:
//
//   multipart/form-data  — the upload. `image` is the file, `cardId` names the
//                          card, and an optional `nickname` rides along.
//   application/json     — nickname-only edits and clearing, where there is no
//                          file and a form-data envelope would be ceremony.
//
// `null` clears a field and an absent field is left alone, in both shapes. That
// distinction is the whole reason this can serve both forms without one wiping
// the other's work.

import { NextRequest, NextResponse } from 'next/server';
import { ok, err } from '@/lib/api';
import { requireUser } from '@/lib/apiAuth';
import { gameSeason } from '@/lib/cards/allowance';
import { resolveWeek } from '@/lib/sleeper/week';
import {
  MAX_IMAGE_BYTES, customizeCard, normalizeNickname, validateImage,
} from '@/lib/cards/customize';
import { prisma } from '@/lib/prisma';
import type { CustomizeResponse } from '@/types/cards';

/**
 * Next parses the whole body into memory, so the cap is enforced twice: once
 * on the declared length before reading, and again on the bytes actually read.
 * The header is a claim and the second check is the fact — but rejecting on the
 * claim first means an oversized upload is refused without buffering it.
 */
function tooLargeByHeader(req: NextRequest): boolean {
  const declared = Number(req.headers.get('content-length') ?? 0);
  // Base64 inflates by about a third, and the form envelope adds a little.
  return Number.isFinite(declared) && declared > MAX_IMAGE_BYTES * 2;
}

/** What the request is asking to change, from either body shape. */
interface Changes {
  cardId: string;
  nickname?: string | null;
  /** Undefined leaves the picture alone; null removes it. */
  image?: { bytes: Uint8Array; mimeType: string } | null;
}

async function readMultipart(req: NextRequest): Promise<Changes> {
  const form = await req.formData();

  const cardId = form.get('cardId');
  if (typeof cardId !== 'string' || !cardId) throw new Error('A "cardId" is required');

  const changes: Changes = { cardId };

  // Absent means "leave the nickname alone"; present-but-empty clears it.
  if (form.has('nickname')) {
    changes.nickname = normalizeNickname(form.get('nickname'));
  }

  const image = form.get('image');
  if (image === null) return changes;

  // An empty file input arrives as an empty string rather than a File.
  if (typeof image === 'string') {
    changes.image = image.trim() ? undefined : null;
    return changes;
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  changes.image = validateImage(bytes, image.type);
  return changes;
}

async function readJson(req: NextRequest): Promise<Changes> {
  const body = (await req.json()) as Record<string, unknown>;

  const cardId = body?.cardId;
  if (typeof cardId !== 'string' || !cardId) throw new Error('A "cardId" is required');

  const changes: Changes = { cardId };
  if ('nickname' in body) changes.nickname = normalizeNickname(body.nickname);

  // JSON can clear an image but not set one — an upload comes as form-data.
  // Anything else is rejected rather than stored, because a client-supplied
  // data URI is an arbitrary string that would reach a card face unchecked.
  if ('customImage' in body) {
    if (body.customImage !== null) {
      throw new Error('Send an image as multipart/form-data, or null to clear it');
    }
    changes.image = null;
  }

  return changes;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  if (tooLargeByHeader(req)) {
    return err(`Images must be under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB`, 413);
  }

  let changes: Changes;
  try {
    changes = req.headers.get('content-type')?.includes('multipart/form-data')
      ? await readMultipart(req)
      : await readJson(req);
  } catch (error) {
    // Everything thrown above is a description of what the client got wrong.
    return err(error instanceof Error ? error.message : 'Could not read that request', 400);
  }

  const season = gameSeason();
  // 'current' rather than 'completed': a pack earned now belongs to the week
  // being played, matching where the ration and a thrown wildcard land.
  const week = await resolveWeek(null, 'current');

  try {
    const result = await customizeCard(
      guard.userId, changes.cardId, season, week,
      { nickname: changes.nickname, image: changes.image },
    );

    // Not owned and not a card at all get the same answer, so this cannot be
    // used to enumerate what other members hold.
    if (!result) return err('No such card in your deck', 404);

    const payload: CustomizeResponse = { cardId: changes.cardId, ...result };
    return ok(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update that card';
    return err(message, 500);
  }
}

/**
 * GET — serves one card's uploaded portrait.
 *
 * The bytes live in their own table and are deliberately not inlined into the
 * collection response: a member with forty customized cards would otherwise
 * drag ten megabytes onto every page load. Here they are one request per card,
 * cached by the browser, and only for cards that actually have one.
 *
 * Scoped to the signed-in member. Ownership is exclusive so a portrait belongs
 * to exactly one person, and there is no reason for anybody else to fetch it.
 *
 * `immutable` is safe despite the URL never changing: a replaced picture is a
 * different `uploadedAt`, and the client appends it as a cache-buster — see
 * toOwnedCardDto in src/lib/cards/service.ts.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireUser();
  if (guard.denied) return guard.denied;

  const cardId = req.nextUrl.searchParams.get('cardId');
  if (!cardId) return err('A "cardId" query parameter is required', 400);

  const season = gameSeason();

  // The member's own override wins over a contributed portrait: it is this
  // season's active choice. Both are checked because a card can have each.
  const [override, portrait] = await Promise.all([
    prisma.cardImage.findFirst({
      where:  { gameSeason: season, cardId, userId: guard.userId },
      select: { mimeType: true, data: true },
    }),
    // Not scoped to the member. A contributed portrait belongs to the card, so
    // whoever holds it this season is entitled to see it.
    prisma.cardPortrait.findUnique({
      where:  { cardId },
      select: { mimeType: true, data: true },
    }),
  ]);

  const image = override ?? portrait;
  if (!image) return err('No picture for that card', 404);

  return new NextResponse(Buffer.from(image.data, 'base64'), {
    headers: {
      'Content-Type': image.mimeType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  }) as NextResponse;
}
