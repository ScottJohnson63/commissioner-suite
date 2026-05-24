'use client';

import Link from 'next/link';
import { useEffect } from 'react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0e0e0f', color: '#e8e6df' }}
    >
      <div className="text-center max-w-sm">
        <p
          className="text-[10px] uppercase tracking-[0.25em] mb-3"
          style={{ color: '#ff4949' }}
        >
          Error
        </p>
        <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm mb-2" style={{ color: '#555' }}>
          An unexpected error occurred.
        </p>
        {error.digest && (
          <p className="text-[11px] font-mono mb-8" style={{ color: '#444' }}>
            {error.digest}
          </p>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#9fff6e')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
          >
            Try again
          </button>
          <Link
            href="/league/dashboard"
            className="px-4 py-2 rounded text-sm border transition-colors"
            style={{ borderColor: '#2a2a2c', color: '#888' }}
          >
            Dashboard
          </Link>
          <Link
            href="/"
            className="px-4 py-2 rounded text-sm border transition-colors"
            style={{ borderColor: '#2a2a2c', color: '#888' }}
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
