// src/app/api/users/route.ts
//
// GET /api/users
//
// Returns all non-admin users registered in the system, ordered by account
// creation date (oldest first). Used by the Commissioner's Manage Members panel
// to list users whose roles can be modified.
//
// The admin user (identified by ADMIN_USERNAME env var, default "admin") is
// excluded from the list because their role is not managed through the UI —
// they always hold the COMMISSIONER role and are the superuser account used
// for credential-based login in initial setup.
//
// Sensitive fields (password hash, sleeperUserId) are excluded from the response.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err } from '@/lib/api';

export async function GET(): Promise<NextResponse> {
  try {
    const adminUsername = process.env.ADMIN_USERNAME ?? 'admin';
    const users = await prisma.user.findMany({
      where: { NOT: { username: adminUsername } },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return ok(users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch users';
    return err(message);
  }
}
