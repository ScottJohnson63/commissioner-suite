// src/app/api/nfl/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_API_URL = process.env.PYTHON_API_URL ?? 'http://localhost:8000';

async function proxyToFastAPI(
  req: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const upstreamPath = path.join('/');
  const search = req.nextUrl.search; // preserve query params
  const upstreamUrl = `${PYTHON_API_URL}/nfl/${upstreamPath}${search}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      // Next.js 15+ requires this for server-side fetch caching control
      cache: 'no-store',
    });

    const data: unknown = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  return proxyToFastAPI(req, path);
}