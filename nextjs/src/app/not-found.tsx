import Link from 'next/link';
import { auth } from '@/auth';

export default async function NotFound() {
  const session = await auth();

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0e0e0f', color: '#e8e6df' }}
    >
      <div className="text-center max-w-sm">
        <p
          className="text-[10px] uppercase tracking-[0.25em] mb-3"
          style={{ color: '#80ff49' }}
        >
          404
        </p>
        <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
        <p className="text-sm mb-8" style={{ color: '#555' }}>
          That route doesn&apos;t exist.
        </p>

        <div className="flex items-center justify-center gap-3">
          {session?.user && (
            <Link
              href="/league/dashboard"
              className="px-4 py-2 rounded text-sm font-medium transition-colors"
              style={{ background: '#80ff49', color: '#0e0e0f' }}
            >
              Go to dashboard
            </Link>
          )}
          <Link
            href="/"
            className="px-4 py-2 rounded text-sm border transition-colors"
            style={{ borderColor: '#2a2a2c', color: '#888' }}
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
