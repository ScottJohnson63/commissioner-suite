// src/lib/api.ts — Thin helpers for consistent JSON response formatting.
//
// ok()   — wraps a successful payload; status defaults to 200.
// err()  — wraps an error string in { error } and sets the status code;
//          status defaults to 500 so callers can omit it for internal errors.
// fail() — err() for a caught exception: logs the real error and sends a
//          message written for the person reading it.
//
// The distinction between the last two is the point. `err` is for a message
// chosen deliberately — a validation failure, a 404, anything the caller
// composed. `fail` is for whatever came out of a `catch`, which is written for
// whoever has to debug it and is nobody's business but the server's.

import { NextResponse } from 'next/server';
import { PublicError } from '@/lib/publicError';

/** 200-OK JSON response. Pass `status` for non-200 success codes (201, 204, etc.). */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, status === 200 ? undefined : { status });
}

/** JSON error response with a guaranteed `{ error: string }` shape. */
export function err(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * What a member sees when the database itself is unreachable.
 *
 * Worth separating from an ordinary failure because it is not a bug and not
 * their fault, and because the honest answer — wait, this will come back — is
 * different from the answer to a broken page.
 *
 * No reassurance and no trailing punctuation flourish: the Draft Deck renders a
 * failed re-read as "{error} — your cards are safe; this page is just out of
 * date." and the same string bare when it has nothing to show, so it has to
 * read correctly both ways.
 */
export const DB_UNAVAILABLE = 'The league database is temporarily unavailable';

/**
 * Whether an error means "the database is not answering" rather than "this code
 * is wrong".
 *
 * `BLOCKED:` is Turso's own prefix when it refuses a database that is past its
 * plan's quota — reads forbidden, writes forbidden, or both. That is the case
 * that prompted all of this: a member opened the Draft Deck and was shown
 * "BLOCKED: Operation was blocked: SQL read operations are forbidden (reads are
 * blocked, do you need to upgrade your plan?)", Turso's billing prompt and all.
 *
 * The Prisma names cover the database being unreachable for duller reasons — no
 * connection, a missing URL, a client that could not start. Matched by name
 * rather than with `instanceof` so this module does not have to import the
 * Prisma client just to classify a string.
 */
function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith('BLOCKED:')) return true;

  return [
    'PrismaClientInitializationError',
    'PrismaClientRustPanicError',
  ].includes(error.name);
}

/**
 * Logs a caught error and returns a response safe to show a member.
 *
 * `userMessage` is what the caller wants said when it is an ordinary failure —
 * "Failed to read collection", "Could not update that card". The thrown text is
 * never it: it is written for a developer, it can name tables, columns and
 * third-party services, and in the case that prompted this it was a vendor
 * asking the member to upgrade their plan.
 *
 * **Logged with console.error rather than to the ErrorLog table**, which is
 * deliberate even though that table is sitting right there. These fire when the
 * database is refusing queries, so a write to it is the least likely thing to
 * survive — and a log write that threw inside a catch block would turn a
 * handled error into an unhandled one, replacing a tidy 500 with a crash. The
 * console reaches the platform's own logs, which is where a server-side stack
 * belongs anyway.
 *
 * @param error       Whatever was caught. Any value: throws are not always Errors.
 * @param userMessage Shown when the failure is not the database being down.
 * @param status      HTTP status, defaulting to 500.
 */
export function fail(error: unknown, userMessage: string, status = 500): NextResponse {
  return err(safeMessage(error, userMessage), status);
}

/**
 * The logging and classification half of `fail`, without the response.
 *
 * For the one caller that cannot use `fail` because it answers with a body of
 * its own — the manual sync reports which leagues succeeded before the failure,
 * and that partial result is the useful part.
 */
export function safeMessage(error: unknown, userMessage: string): string {
  console.error('[api]', userMessage, '—', error);

  // A PublicError was written to be read — "Expected 10 teams, got 9" is the
  // answer, not a leak. See lib/publicError.ts.
  if (error instanceof PublicError) return error.message;

  return isDatabaseUnavailable(error) ? DB_UNAVAILABLE : userMessage;
}
