// src/app/api/matchups/[id]/route.ts
//
// PATCH /api/matchups/{id}
//
// Allows a commissioner to make manual corrections to an existing matchup
// after a schedule has been generated. Supported edits:
//
//   homeTeamId — swap the home team to a different team.
//   awayTeamId — swap the away team to a different team.
//   week       — move the matchup to a different week number.
//
// All fields are optional — only the fields present in the request body are
// updated. This means a partial update (e.g. just changing the week) does not
// accidentally clear the team IDs.
//
// The Prisma update will throw if `id` does not exist in the Matchup table;
// that error is caught and returned as a 404.
//
// Note: this endpoint does not re-validate schedule constraints after the edit.
// It is intentionally flexible so commissioners can fix generator edge-cases.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const body = await req.json() as {
    homeTeamId?: string;
    awayTeamId?: string;
    week?: number;
  };

  try {
    const updated = await prisma.matchup.update({
      where: { id: id },
      data: body,
    });
    return ok(updated);
  } catch {
    return err('Matchup not found', 404);
  }
}
