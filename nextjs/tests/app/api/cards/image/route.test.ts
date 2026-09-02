// tests/app/api/cards/image/route.test.ts
//
// Covers POST /api/cards/image at the boundary: the two body shapes it accepts,
// and every way it refuses one.
//
// The rules that matter are about what gets past it. A client-supplied data URI
// must never be stored — an image arrives as a file and is encoded server-side,
// because a string the client chose would reach a card face unchecked. And an
// unowned card must answer 404 rather than 403, so the route cannot be used to
// discover what other members hold.
//
// The customization itself is tested in tests/unit/lib/cards/customize.test.ts.

import { NextRequest } from 'next/server';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockRequireUser = jest.fn<() => Promise<unknown>>();
const mockCustomize = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockResolveWeek = jest.fn<() => Promise<number>>();

jest.mock('@/lib/apiAuth', () => ({ requireUser: () => mockRequireUser() }));
jest.mock('@/lib/sleeper/week', () => ({ resolveWeek: () => mockResolveWeek() }));
jest.mock('@/lib/cards/allowance', () => ({ gameSeason: () => 2026 }));
jest.mock('@/lib/cards/customize', () => {
  const actual = jest.requireActual('@/lib/cards/customize') as Record<string, unknown>;
  return { ...actual, customizeCard: (...a: unknown[]) => mockCustomize(...a) };
});

import { POST } from '@/app/api/cards/image/route';

const RESULT = {
  nickname: 'The Bus', hasCustomImage: true, isContributed: true,
  eligibleForReward: true, packsAwarded: 1, packsEarnedTotal: 1, rewardsRemaining: 14,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUser.mockResolvedValue({ denied: null, userId: 'u1' });
  mockResolveWeek.mockResolvedValue(3);
  mockCustomize.mockResolvedValue(RESULT);
});

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('https://x/api/cards/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(form: FormData): NextRequest {
  return new NextRequest('https://x/api/cards/image', { method: 'POST', body: form });
}

describe('POST /api/cards/image', () => {
  it('refuses a signed-out request', async () => {
    mockRequireUser.mockResolvedValue({
      denied: new Response('no', { status: 401 }), userId: null,
    });
    const res = await POST(jsonRequest({ cardId: 'c1', nickname: 'Bus' }));
    expect(res.status).toBe(401);
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  it('saves a nickname sent as JSON', async () => {
    const res = await POST(jsonRequest({ cardId: 'c1', nickname: 'The Bus' }));
    expect(res.status).toBe(200);
    expect(mockCustomize).toHaveBeenCalledWith(
      'u1', 'c1', 2026, 3, expect.objectContaining({ nickname: 'The Bus' }),
    );
  });

  // WHY: this is the injection guard. A data URI is rendered according to its
  //      declared type, so a client-chosen one is an arbitrary payload on a
  //      card face — an SVG among them, which is a script host. Images must
  //      arrive as files and be encoded here.
  it('refuses a client-supplied image string', async () => {
    const res = await POST(jsonRequest({
      cardId: 'c1', customImage: 'data:image/svg+xml;base64,PHN2Zz4=',
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/multipart\/form-data/) }),
    );
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  // WHY: null is the one image value JSON may carry, because "remove my
  //      picture" needs a route and does not need an upload.
  it('allows JSON to clear an image', async () => {
    const res = await POST(jsonRequest({ cardId: 'c1', customImage: null }));
    expect(res.status).toBe(200);
    expect(mockCustomize).toHaveBeenCalledWith(
      'u1', 'c1', 2026, 3, expect.objectContaining({ image: null }),
    );
  });

  it('requires a cardId', async () => {
    const res = await POST(jsonRequest({ nickname: 'Bus' }));
    expect(res.status).toBe(400);
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  it('passes an uploaded file through as validated bytes', async () => {
    const form = new FormData();
    form.append('cardId', 'c1');
    form.append('nickname', 'The Bus');
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));

    const res = await POST(formRequest(form));
    expect(res.status).toBe(200);
    const [, , , , changes] = mockCustomize.mock.calls[0] as unknown[];
    expect(changes).toEqual({
      nickname: 'The Bus',
      image: { bytes: expect.any(Uint8Array), mimeType: 'image/jpeg' },
    });
  });

  it('refuses an uploaded SVG', async () => {
    const form = new FormData();
    form.append('cardId', 'c1');
    form.append('image', new File([new Uint8Array([1])], 'x.svg', { type: 'image/svg+xml' }));

    const res = await POST(formRequest(form));
    expect(res.status).toBe(400);
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  // WHY: an absent field must be left alone rather than cleared, or uploading
  //      a picture would wipe the nickname the member had already set.
  it('leaves the nickname alone when the form omits it', async () => {
    const form = new FormData();
    form.append('cardId', 'c1');
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));

    await POST(formRequest(form));
    const changes = mockCustomize.mock.calls[0][4] as Record<string, unknown>;
    // undefined, not null: customizeCard reads undefined as "leave alone" and
    // null as "clear". Sending null here would wipe an existing nickname on
    // every picture upload.
    expect(changes.nickname).toBeUndefined();
    expect(changes.image).toEqual({ bytes: expect.any(Uint8Array), mimeType: 'image/jpeg' });
  });

  // WHY: 404 rather than 403. "That is not yours" and "there is no such card"
  //      must be the same answer, or the route enumerates other people's decks.
  it('answers 404 for a card the member does not own', async () => {
    mockCustomize.mockResolvedValue(null);
    const res = await POST(jsonRequest({ cardId: 'someone-elses', nickname: 'Bus' }));
    expect(res.status).toBe(404);
  });

  it('reports a nickname that is too long as a 400', async () => {
    const res = await POST(jsonRequest({ cardId: 'c1', nickname: 'x'.repeat(200) }));
    expect(res.status).toBe(400);
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  // WHY: the body is parsed into memory, so an oversized upload is refused on
  //      its declared length before it is buffered.
  it('refuses an oversized body on the content-length header', async () => {
    const req = new NextRequest('https://x/api/cards/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': String(50 * 1024 * 1024) },
      body: JSON.stringify({ cardId: 'c1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(mockCustomize).not.toHaveBeenCalled();
  });

  it('returns the packs the save earned', async () => {
    const res = await POST(jsonRequest({ cardId: 'c1', nickname: 'The Bus' }));
    expect(await res.json()).toEqual(expect.objectContaining({
      cardId: 'c1', packsAwarded: 1, isContributed: true, rewardsRemaining: 14,
    }));
  });
});
