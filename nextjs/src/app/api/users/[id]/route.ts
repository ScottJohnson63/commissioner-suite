import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await req.json() as { role?: 'COMMISSIONER' | 'MEMBER' | 'PLAYER' };

  if (!body.role || !['COMMISSIONER', 'MEMBER', 'PLAYER'].includes(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, name: true, username: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
}
