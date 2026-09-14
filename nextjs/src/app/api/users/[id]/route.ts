// src/app/api/users/[id]/route.ts
//
// PATCH /api/users/{id}
//
// Updates the role of the user identified by `id`. COMMISSIONER only:
//
//   Caller role         | Can assign  | Can modify
//   ────────────────────┼─────────────┼──────────────────────────────
//   COMMISSIONER        | any role    | any non-self user
//   MEMBER / PLAYER     | —           | —  (403)
//   pending / none      | —           | —  (403)
//
// This used to admit MEMBER callers too, for non-COMMISSIONER targets and the
// MEMBER/PLAYER roles only. That was deliberate, but role administration is
// not a member-tier capability: one borrowed or disgruntled member could demote
// every peer to PLAYER and lock the league out of its own app, with no
// commissioner in the loop.
//
// It also made the pending-OAuth session bug a write primitive rather than a
// disclosure one — an unverified caller arrived carrying role MEMBER, and this
// endpoint trusted the role it was handed.
//
// Self-role changes are always rejected (400) regardless of caller role to
// prevent accidental lock-outs where a COMMISSIONER demotes themselves.
//
// Valid roles: COMMISSIONER | MEMBER | PLAYER
//   • COMMISSIONER — full access, can manage members and generate schedules.
//   • MEMBER       — read-only access to the Players Association dashboard.
//   • PLAYER       — base role; no special access beyond the default pages.
//
// AUTH: PATCH inline — who may set which role is a matrix, not a threshold —
//      see the table above

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { denyPending } from '@/lib/apiAuth';
import { ok, err } from '@/lib/api';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();

  // auth() inline rather than requireCommissioner(): the self-check below needs
  // session.user.id, and calling a guard as well would mean a second round trip
  // that could disagree with this one. denyPending is the guards' own predicate.
  const pending = denyPending(session);
  if (pending) return pending;

  if (session?.user?.role !== 'COMMISSIONER') {
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

  try {
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) return err('User not found', 404);

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
