// src/lib/api.ts — Thin helpers for consistent JSON response formatting.
//
// ok()  — wraps a successful payload; status defaults to 200.
// err() — wraps an error string in { error } and sets the status code;
//         status defaults to 500 so callers can omit it for internal errors.

import { NextResponse } from 'next/server';

/** 200-OK JSON response. Pass `status` for non-200 success codes (201, 204, etc.). */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, status === 200 ? undefined : { status });
}

/** JSON error response with a guaranteed `{ error: string }` shape. */
export function err(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
