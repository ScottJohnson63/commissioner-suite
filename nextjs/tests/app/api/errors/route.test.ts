// tests/app/api/errors/route.test.ts
//
// Tests for POST /api/errors (client-side error reporter).
// Mocks @/lib/prisma.

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

import { POST, GET } from '@/app/api/errors/route';
import { prisma } from '@/lib/prisma';

const mockCreate   = prisma.errorLog.create   as jest.MockedFunction<typeof prisma.errorLog.create>;
const mockFindMany = prisma.errorLog.findMany as jest.MockedFunction<typeof prisma.errorLog.findMany>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/errors', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
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
  });

  // WHY: The GET endpoint returns recent error logs for debugging, no auth needed.
  it('returns 200 with error log entries', async () => {
    const fakeLogs = [{ id: 'e1', message: 'Error 1', createdAt: new Date() }];
    mockFindMany.mockResolvedValueOnce(fakeLogs as never);

    const res = await GET(new NextRequest('http://localhost/api/errors'));
    expect(res.status).toBe(200);

    const body = await res.json() as typeof fakeLogs;
    expect(body).toHaveLength(1);
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
