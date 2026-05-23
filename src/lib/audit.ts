// src/lib/audit.ts
//
// Central helper for writing audit log entries.
// Import and call from any route handler after a successful operation.

import { prisma } from '@/lib/prisma';

// Mirrors the AuditActionType enum in schema.prisma.
// Using a string literal union avoids depending on Prisma client generation state.
export type AuditActionType = 'SYNC' | 'GENERATE' | 'DELETE' | 'EXPORT';

export type AuditDetail = Record<string, unknown>;

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