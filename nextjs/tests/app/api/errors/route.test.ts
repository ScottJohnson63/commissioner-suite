// tests/app/api/errors/route.test.ts
//
// Tests for GET /api/errors (signed-in readers only) and POST /api/errors
// (the open client-side error reporter, bounded by an IP rate limit and
// per-field length caps).
// Mocks @/lib/prisma and @/auth.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    errorLog: {
      findMany: jest.fn(),
      create:   jest.fn(),
    },
  },
}));

jest.mock('@/auth', () => ({ auth: jest.fn() }));

import { POST, GET } from '@/app/api/errors/route';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { ERROR_REPORT_LIMIT } from '@/lib/rateLimit';

const mockCreate   = prisma.errorLog.create   as jest.MockedFunction<typeof prisma.errorLog.create>;
const mockFindMany = prisma.errorLog.findMany as jest.MockedFunction<typeof prisma.errorLog.findMany>;
const mockAuth     = auth                     as jest.MockedFunction<typeof auth>;

// ── Helpers ───────────────────────────────────────────────────────────────────

// The route's limiter lives at module scope and is shared by every test in this
// file, so each test posts from its own IP rather than spending a common bucket.
let nextIp = 0;
function freshIp(): string { return `203.0.113.${nextIp++ % 256}`; }

function makePost(body: unknown, ip = freshIp()): NextRequest {
  return new NextRequest('http://localhost/api/errors', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

/** The `data` Prisma was asked to create on the most recent call. */
function lastCreatedData(): Record<string, unknown> {
  const call = mockCreate.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
  return call.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/errors', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ id: 'err-1' } as never);
  });

  // WHY: A browser error report with a message must be persisted and acknowledged
  //      with a 200 that contains the new record's id.
  it('persists the error and returns 200 with the new id', async () => {
    const res = await POST(makePost({ message: 'Uncaught TypeError', stack: 'at App.tsx:42' }));
    expect(res.status).toBe(200);

    const body = await res.json() as { id: string };
    expect(body.id).toBe('err-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // WHY: message is the only required field. A request without it must return
  //      400 so the client knows the report was not accepted.
  it('returns 400 when message is missing', async () => {
    const res = await POST(makePost({ stack: 'some stack' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: Optional fields (stack, username, url) must be forwarded to the DB
  //      if provided so engineers can debug with full context.
  it('forwards optional fields to Prisma when provided', async () => {
    await POST(makePost({ message: 'Error', stack: 'trace', username: 'alice', url: '/league' }));

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        message:  'Error',
        stack:    'trace',
        username: 'alice',
        url:      '/league',
      }),
    });
  });

  // WHY: One request must not be able to write an unbounded row. Over-long
  //      values are truncated rather than refused — a shortened report is still
  //      worth having, and the head of a stack is the useful part.
  it('truncates over-long fields instead of storing them whole', async () => {
    await POST(makePost({
      message:  'm'.repeat(2_500),
      stack:    's'.repeat(9_000),
      username: 'u'.repeat(200),
      url:      `/league?q=${'x'.repeat(600)}`,
    }));

    const data = lastCreatedData();
    expect((data.message  as string).length).toBe(2_000);
    expect((data.stack    as string).length).toBe(8_000);
    expect((data.username as string).length).toBe(100);
    expect((data.url      as string).length).toBe(500);
    // The truncation is marked so a reader is not misled into debugging a
    // stack that appears to simply end.
    expect(data.stack as string).toMatch(/…$/);
  });

  // WHY: A field just under its cap is stored exactly as sent — truncation must
  //      not touch reports that are already within bounds.
  it('stores a field at its cap unchanged', async () => {
    const message = 'm'.repeat(2_000);
    await POST(makePost({ message }));
    expect(lastCreatedData().message).toBe(message);
  });

  // WHY: The old handler ran every field through String(), so an object arrived
  //      in the log as the useless '[object Object]'. A non-string message is a
  //      malformed report, not a report about nothing.
  it('returns 400 when message is not a string', async () => {
    const res = await POST(makePost({ message: { nested: 'oops' } }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: A blank or whitespace-only message carries nothing to debug and must
  //      not buy a row.
  it('returns 400 for a whitespace-only message', async () => {
    const res = await POST(makePost({ message: '   ' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: Non-string optional fields are dropped rather than coerced, leaving the
  //      column null instead of storing '[object Object]'.
  it('drops non-string optional fields', async () => {
    await POST(makePost({ message: 'Error', stack: { at: 'App.tsx' }, url: 42 }));

    const data = lastCreatedData();
    expect(data.stack).toBeUndefined();
    expect(data.url).toBeUndefined();
  });

  // WHY: The body is turned away before it is parsed, so a megabyte of JSON
  //      cannot be used to burn CPU on every request.
  it('returns 413 for a body past the size cap', async () => {
    const res = await POST(makePost({ message: 'x'.repeat(40_000) }));
    expect(res.status).toBe(413);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: A declared length past the cap is refused before the body is read at
  //      all, so an honest client's oversized report costs nothing to turn away.
  it('returns 413 on a content-length past the cap without reading the body', async () => {
    const req = new NextRequest('http://localhost/api/errors', {
      method: 'POST',
      body: JSON.stringify({ message: 'short' }),
      headers: {
        'content-type':    'application/json',
        'content-length':  String(10 * 1024 * 1024),
        'x-forwarded-for': freshIp(),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: Malformed JSON is the client's mistake, so it should read as 400 rather
  //      than the 500 the old handler returned from its catch-all.
  it('returns 400 for a body that is not valid JSON', async () => {
    const res = await POST(makePost('{"message": '));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: 'null' is valid JSON, and reading a field off it throws — which the
  //      handler's catch-all would have reported as a 500 for what is the
  //      caller's mistake.
  it('returns 400 for a JSON body that is not an object', async () => {
    expect((await POST(makePost('null'))).status).toBe(400);
    expect((await POST(makePost('[{"message":"x"}]'))).status).toBe(400);
    expect((await POST(makePost('42'))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // WHY: The endpoint has to stay open to signed-out visitors, so the per-IP
  //      limit is the only thing stopping one caller from flooding the table.
  it('rejects further reports from one IP once the limit is spent', async () => {
    const ip = freshIp();

    for (let i = 0; i < ERROR_REPORT_LIMIT; i++) {
      const res = await POST(makePost({ message: `error ${i}` }, ip));
      expect(res.status).toBe(200);
    }

    const refused = await POST(makePost({ message: 'one too many' }, ip));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(mockCreate).toHaveBeenCalledTimes(ERROR_REPORT_LIMIT);
  });

  // WHY: The limit is per caller. One noisy visitor must not silence everyone
  //      else's reports.
  it('keeps accepting reports from other IPs', async () => {
    const noisy = freshIp();
    for (let i = 0; i <= ERROR_REPORT_LIMIT; i++) await POST(makePost({ message: 'flood' }, noisy));

    const res = await POST(makePost({ message: 'genuine crash' }, freshIp()));
    expect(res.status).toBe(200);
  });

  // WHY: If Prisma throws, the endpoint should return 500 rather than crashing.
  it('returns 500 when Prisma throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB write failed'));

    const res = await POST(makePost({ message: 'Test error' }));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/errors', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'COMMISSIONER' } } as never);
  });

  // WHY: The log carries stack traces, usernames and the URLs visitors were on.
  //      The route's header used to claim it was admin-only; nothing enforced
  //      that, so an anonymous caller could read all of it. /log, the only page
  //      that reads it, shows nothing to anyone but admin, so the route is now
  //      as narrow as the API's roles allow.
  it('returns 403 when the caller is signed out', async () => {
    mockAuth.mockResolvedValueOnce(null as never);

    const res = await GET(new NextRequest('http://localhost/api/errors'));
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a member, who has no /log page to read it from', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'u1', role: 'MEMBER' } } as never);

    const res = await GET(new NextRequest('http://localhost/api/errors'));
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  // WHY: The GET endpoint returns recent error logs for debugging to a
  //      commissioner.
  it('returns 200 with error log entries', async () => {
    const fakeLogs = [{ id: 'e1', message: 'Error 1', createdAt: new Date() }];
    mockFindMany.mockResolvedValueOnce(fakeLogs as never);

    const res = await GET(new NextRequest('http://localhost/api/errors'));
    expect(res.status).toBe(200);

    const body = await res.json() as typeof fakeLogs;
    expect(body).toHaveLength(1);
  });

  // WHY: A database failure while reading the log should surface as a 500 with
  //      the reason, not an unhandled throw the page renders as HTML.
  it('returns 500 when Prisma throws', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB read failed'));

    const res = await GET(new NextRequest('http://localhost/api/errors'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'DB read failed' });
  });

  // WHY: The limit cap (500) must be enforced to prevent memory issues from
  //      fetching thousands of error records in a single request.
  it('caps the take at 500 for large limit values', async () => {
    mockFindMany.mockResolvedValueOnce([] as never);

    await GET(new NextRequest('http://localhost/api/errors?limit=99999'));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });
});
