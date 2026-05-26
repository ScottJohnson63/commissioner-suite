import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const limitParam = searchParams.get('limit');
  const take = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

  try {
    const logs = await prisma.errorLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return NextResponse.json(logs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch error logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      message?: string;
      stack?: string;
      username?: string;
      url?: string;
    };

    if (!body.message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const entry = await prisma.errorLog.create({
      data: {
        message: String(body.message),
        stack:   body.stack   ? String(body.stack)   : undefined,
        username: body.username ? String(body.username) : undefined,
        url:     body.url     ? String(body.url)     : undefined,
      },
    });

    return NextResponse.json({ id: entry.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write error log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
