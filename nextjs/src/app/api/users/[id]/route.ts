// src/app/api/users/[id]/route.ts
//
// PATCH /api/users/{id}
//
// Updates the role of the user identified by `id`. Accessible to both
// COMMISSIONER and MEMBER roles, with the following permission matrix:
//
//   Caller role    | Can assign     | Can modify
//   ───────────────┼────────────────┼───────────────────────────────
//   COMMISSIONER   | any role       | any non-self user
//   MEMBER         | MEMBER/PLAYER  | non-COMMISSIONER users only
//   PLAYER / none  | —              | —  (403)
//
// Self-role changes are always rejected (400) regardless of caller role to
// prevent accidental lock-outs where a COMMISSIONER demotes themselves.
//
// Valid roles: COMMISSIONER | MEMBER | PLAYER
//   • COMMISSIONER — full access, can manage members and generate schedules.
//   • MEMBER       — read-only access to the Players Association dashboard.
//   • PLAYER       — base role; no special access beyond the default pages.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { ok, err } from '@/lib/api';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  const callerRole = session?.user?.role;

  if (callerRole !== 'COMMISSIONER' && callerRole !== 'MEMBER') {
    return err('Forbidden', 403);
  }

  const { id } = await params;

  if (session?.user?.id === id) {
    return err('Cannot change your own role', 400);
  }

  const body = await req.json() as { role?: 'COMMISSIONER' | 'MEMBER' | 'PLAYER' };

  if (!body.role || !['COMMISSIONER', 'MEMBER', 'PLAYER'].includes(body.role)) {
    return err('Invalid role', 400);
  }

  // Members cannot assign the COMMISSIONER role
  if (callerRole === 'MEMBER' && body.role === 'COMMISSIONER') {
    return err('Forbidden', 403);
  }

  try {
    // Members cannot change a COMMISSIONER's role
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) return err('User not found', 404);

    if (callerRole === 'MEMBER' && target.role === 'COMMISSIONER') {
      return err('Forbidden', 403);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, name: true, username: true, email: true, role: true, createdAt: true },
    });
    return ok(updated);
  } catch {
    return err('User not found', 404);
  }
}
