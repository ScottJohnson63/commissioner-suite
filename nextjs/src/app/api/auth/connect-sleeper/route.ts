import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { validateSleeperMembership } from '@/auth';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the raw (decrypted) JWT — the only place pending OAuth profile data lives.
  const token = await getToken({ req });

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body             = (await req.json()) as { sleeperUsername?: string };
  const sleeperUsername  = body.sleeperUsername?.trim().toLowerCase();

  if (!sleeperUsername) {
    return NextResponse.json({ error: 'sleeperUsername is required' }, { status: 400 });
  }

  const isPending = token.pendingOAuth === true;

  // ── Path A: New OAuth user — pending Sleeper verification ────────────────────
  if (isPending) {
    const provider          = token.pendingProvider          as string | undefined;
    const providerAccountId = token.pendingProviderAccountId as string | undefined;

    if (!provider || !providerAccountId) {
      return NextResponse.json(
        { error: 'Missing OAuth provider data. Please sign in again.' },
        { status: 400 },
      );
    }

    // Validate Sleeper membership
    const sleeper = await validateSleeperMembership(sleeperUsername);
    if (!sleeper) {
      return NextResponse.json(
        { error: 'Your Sleeper account is not a member of any registered league.' },
        { status: 403 },
      );
    }

    // Guard: don't create a duplicate account if something raced
    const existingAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    });
    if (existingAccount) {
      // Account was already created (unlikely race). Just return the userId so
      // the client can refresh its session.
      return NextResponse.json({ ok: true, userId: existingAccount.userId });
    }

    // Create User then Account in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name:         (token.pendingName  as string | null) ?? null,
          email:        (token.pendingEmail as string | null) ?? null,
          image:        (token.pendingImage as string | null) ?? null,
          username:     sleeper.username,   // Sleeper username becomes the app username
          sleeperUserId: sleeper.userId,
          role:         'MEMBER',
          // username has @default(cuid()) as a Prisma-layer fallback; providing
          // the real Sleeper username here overrides it.
        },
      });

      await tx.account.create({
        data: {
          userId:           newUser.id,
          type:             'oauth',
          provider,
          providerAccountId,
          token_type:       (token.pendingTokenType  as string | null) ?? null,
          scope:            (token.pendingScope       as string | null) ?? null,
          expires_at:       (token.pendingExpiresAt   as number | null) ?? null,
        },
      });

      return newUser;
    });

    return NextResponse.json({ ok: true, userId: result.id });
  }

  // ── Path B: Existing credentials/admin user reconnecting their Sleeper ───────
  const userId = token.id as string | null;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Commissioners (e.g. admin) skip Sleeper validation
  const isCommissioner = dbUser.role === 'COMMISSIONER';
  if (!isCommissioner) {
    const sleeper = await validateSleeperMembership(sleeperUsername);
    if (!sleeper) {
      return NextResponse.json(
        { error: 'Your Sleeper account is not a member of any registered league.' },
        { status: 403 },
      );
    }
    await prisma.user.update({
      where: { id: userId },
      data: {
        sleeperUserId: sleeper.userId,
        ...(dbUser.username !== ADMIN_USERNAME && { username: sleeper.username }),
      },
    });
  }

  return NextResponse.json({ ok: true, userId });
}
