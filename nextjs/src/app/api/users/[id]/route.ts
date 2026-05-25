import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  const callerRole = session?.user?.role;

  if (callerRole !== 'COMMISSIONER' && callerRole !== 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  if (session?.user?.id === id) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
  }

  const body = await req.json() as { role?: 'COMMISSIONER' | 'MEMBER' | 'PLAYER' };

  if (!body.role || !['COMMISSIONER', 'MEMBER', 'PLAYER'].includes(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  // Members cannot assign the COMMISSIONER role
  if (callerRole === 'MEMBER' && body.role === 'COMMISSIONER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Members cannot change a COMMISSIONER's role
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (callerRole === 'MEMBER' && target.role === 'COMMISSIONER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
