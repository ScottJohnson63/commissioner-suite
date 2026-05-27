// tests/unit/lib/api.test.ts
//
// Tests for the JSON response helpers in src/lib/api.ts.
// ok() and err() are thin wrappers around NextResponse.json() — we verify
// the status code and body shape, not the internal NextResponse implementation.

import { describe, it, expect } from '@jest/globals';
import { ok, err } from '@/lib/api';

describe('ok()', () => {
  // WHY: Default status must be 200 so callers don't have to pass it for every
  //      successful response — the most common code path.
  it('returns a 200 response by default', async () => {
    const res = ok({ id: 1 });
    expect(res.status).toBe(200);
  });

  // WHY: The body must be the exact data passed in, not wrapped in an extra layer.
  it('includes the data payload in the JSON body', async () => {
    const data = { id: 1, name: 'Alice' };
    const res = ok(data);
    const body = await res.json();
    expect(body).toEqual(data);
  });

  // WHY: 201 Created is used after POST operations that insert a new resource.
  //      Verifies the optional status argument is forwarded correctly.
  it('returns a 201 response when status 201 is passed', async () => {
    const res = ok({ created: true }, 201);
    expect(res.status).toBe(201);
  });

  // WHY: Arrays are a common response body type (e.g. /api/leagues returning
  //      a list). Ensures ok() is not restricted to objects.
  it('works with array payloads', async () => {
    const res = ok([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual([1, 2, 3]);
  });

  // WHY: null is a valid JSON value for "no content" responses. Ensures the
  //      generic type parameter allows primitive/null data without coercion.
  it('works with null payload', async () => {
    const res = ok(null);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('err()', () => {
  // WHY: Default status must be 500 (Internal Server Error) so catch blocks
  //      can call err(e.message) without specifying a code every time.
  it('returns a 500 response by default', async () => {
    const res = err('something broke');
    expect(res.status).toBe(500);
  });

  // WHY: The body must have a guaranteed { error: string } shape so the
  //      client can always safely access res.error without extra type guards.
  it('wraps the message in an { error } object', async () => {
    const res = err('not found', 404);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: 'not found' });
  });

  // WHY: 404 is common for "resource not found" and 400 for bad input —
  //      the optional status param must propagate to the response.
  it('returns a 404 response when status 404 is passed', async () => {
    const res = err('missing', 404);
    expect(res.status).toBe(404);
  });

  // WHY: 400 is used for client validation errors. Another explicit status
  //      check ensures the arg is not hardcoded to 500 internally.
  it('returns a 400 response when status 400 is passed', async () => {
    const res = err('bad request', 400);
    expect(res.status).toBe(400);
  });
});
