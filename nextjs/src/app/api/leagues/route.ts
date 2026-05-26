// src/app/api/leagues/route.ts
//
// GET /api/leagues
//
// Returns all leagues stored in the local database, ordered newest-first.
// Used by the League Selector component to populate the league switcher
// dropdown in the Commissioner dashboard.
//
// No auth required at the API level — all authenticated users can fetch the
// league list (they need it to know which league context to use for other calls).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const leagues = await prisma.league.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return ok(leagues);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch leagues';
    return err(message);
  }
}
