import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(): Promise<NextResponse> {
  try {
    const leagues = await prisma.league.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(leagues);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch leagues';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}