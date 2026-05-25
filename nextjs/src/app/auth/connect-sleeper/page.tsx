'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function ConnectSleeperPage() {
  const { update }                = useSession();
  const router                    = useRouter();
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const username = input.trim().toLowerCase();
    if (!username) return;

    setLoading(true);
    setError(null);

    try {
      const res  = await fetch('/api/auth/connect-sleeper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sleeperUsername: username }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; userId?: string };

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Try again.');
        return;
      }

      // Refresh the JWT. For new OAuth users we pass the newly created userId so
      // the jwt callback can load the real DB record and clear the pending state.
      await update(data.userId ? { userId: data.userId } : undefined);

      router.push('/league/dashboard');
    } catch {
      setError('Failed to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0e0e0f' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.25em] mb-2" style={{ color: '#555' }}>
            Commissioner Suite
          </p>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: '#e8e6df' }}>
            Verify League Membership
          </h1>
          <p className="text-sm mt-2" style={{ color: '#555' }}>
            Enter your Sleeper username to confirm you&apos;re in a registered league.
          </p>
        </div>

        {error && (
          <div
            className="mb-4 px-3 py-2 rounded text-xs border"
            style={{
              background:   'rgba(255,73,73,0.08)',
              color:        '#ff4949',
              borderColor:  'rgba(255,73,73,0.2)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Sleeper username"
            autoFocus
            autoComplete="off"
            className="w-full bg-[#0e0e0f] border border-[#2a2a2c] rounded px-3 py-2.5 text-sm
                       text-[#e8e6df] placeholder-[#444] focus:outline-none focus:border-[#444]
                       transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full px-4 py-2.5 rounded text-sm font-medium transition-colors disabled:opacity-40"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) e.currentTarget.style.background = '#9fff6e';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
          >
            {loading ? 'Verifying…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
