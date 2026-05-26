// src/lib/audit.ts
//
// Central helper for writing audit log entries.
//
// Import and call from any route handler after a successful commissioner
// operation (sync, schedule generation, export, etc.) so that the activity
// log reflects an accurate history of changes made to each league.
//
// Design decisions:
//   • writeAuditLog is intentionally fire-and-forget: it swallows errors so
//     that a DB write failure never rolls back or crashes the primary operation.
//   • The `detail` field is serialised to JSON so any structured data can be
//     stored without schema migrations. The audit viewer must JSON.parse it.

import { prisma } from '@/lib/prisma';

/**
 * The set of auditable operations, mirroring the `AuditActionType` enum in
 * `schema.prisma`. A string union is used here so this file stays compilable
 * without depending on Prisma client generation state (useful in CI).
 *
 *   SYNC     — league data was pulled from Sleeper and written to the DB.
 *   GENERATE — a schedule, draft order, or lottery result was generated.
 *   DELETE   — a schedule or other record was deleted.
 *   EXPORT   — a schedule was exported to CSV.
 */
export type AuditActionType = 'SYNC' | 'GENERATE' | 'DELETE' | 'EXPORT';

/** Arbitrary key-value payload stored alongside each audit log entry. */
export type AuditDetail = Record<string, unknown>;

/**
 * Creates an audit log entry in the database.
 *
 * Failures are caught and logged to the console but never re-thrown —
 * an audit failure must never cause the primary API response to fail.
 *
 * @param action    The type of action being audited (SYNC | GENERATE | DELETE | EXPORT).
 * @param leagueId  Internal league primary key to associate the entry with;
 *                  pass `null` for actions that are not league-specific.
 * @param detail    Optional structured payload (serialised as JSON).
 *                  Include whatever is useful for debugging — e.g. team counts,
 *                  schedule IDs, number of records affected.
 */
export async function writeAuditLog(
  action: AuditActionType,
  leagueId: string | null,
  detail: AuditDetail = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        leagueId: leagueId ?? undefined,
        detail: JSON.stringify(detail),
      },
    });
  } catch (err) {
    // Audit failures must never crash the primary operation.
    console.error('[audit] Failed to write audit log:', err);
  }
}