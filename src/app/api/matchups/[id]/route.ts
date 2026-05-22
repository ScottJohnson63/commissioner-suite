// src/app/api/matchups/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Commissioner can manually swap home/away or reassign a week
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
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: 'Matchup not found' }, { status: 404 });
  }
}