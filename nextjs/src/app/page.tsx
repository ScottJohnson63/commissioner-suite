'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState<string | null>(null);
  const [error, setError]                     = useState<string | null>(null);
  const [showModal, setShowModal]             = useState(false);

  async function handleOAuth(provider: 'discord' | 'google') {
    setLoading(provider);
    setError(null);
    await signIn(provider, { callbackUrl: '/auth/redirect' });
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading('credentials');
    setError(null);

    const result = await signIn('credentials', {
      username:  username.trim(),
      password,
      redirect:  false,
    });

    if (result?.error) {
      setError('Sign in failed. Check your credentials.');
      setLoading(null);
    } else {
      window.location.href = '/auth/redirect';
    }
  }

  function openModal() {
    setError(null);
    setShowModal(true);
  }

  function closeModal() {
    if (loading === 'credentials') return;
    setShowModal(false);
    setError(null);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0e0e0f' }}
    >
      <div className="w-full max-w-sm">

        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.25em] mb-2" style={{ color: '#555' }}>
            Commissioner Suite
          </p>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: '#e8e6df' }}>
            Sign in
          </h1>
        </div>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-3 mb-6">
          <button
            onClick={() => handleOAuth('discord')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ background: '#5865F2', color: '#fff' }}
          >
            <DiscordIcon />
            {loading === 'discord' ? 'Redirecting…' : 'Continue with Discord'}
          </button>

          <button
            onClick={() => handleOAuth('google')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded text-sm font-medium border transition-colors disabled:opacity-50"
            style={{
              background: '#141415',
              color: '#e8e6df',
              borderColor: '#2a2a2c',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#444')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2a2c')}
          >
            <GoogleIcon />
            {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>
        </div>

        {/* Commissioner login link */}
        <p className="text-center text-[11px]" style={{ color: '#444' }}>
          <button
            onClick={openModal}
            className="underline underline-offset-2 transition-colors"
            style={{ color: '#666' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#999')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
          >
            Commissioner login
          </button>
        </p>

      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 flex items-center justify-center px-4 z-50"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className="w-full max-w-sm rounded-lg p-6 relative"
            style={{ background: '#141415', border: '1px solid #2a2a2c' }}
          >
            {/* Close button */}
            <button
              onClick={closeModal}
              disabled={loading === 'credentials'}
              className="absolute top-4 right-4 text-xs transition-colors disabled:opacity-40"
              style={{ color: '#555' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#999')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              aria-label="Close"
            >
              ✕
            </button>

            <h2 className="text-base font-semibold mb-5" style={{ color: '#e8e6df' }}>
              Commissioner login
            </h2>

            {/* Error banner */}
            {error && (
              <div
                className="mb-4 px-3 py-2 rounded text-xs border"
                style={{
                  background: 'rgba(255,73,73,0.08)',
                  color: '#ff4949',
                  borderColor: 'rgba(255,73,73,0.2)',
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleCredentials} className="flex flex-col gap-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Admin username"
                autoComplete="username"
                className="w-full border rounded px-3 py-2.5 text-sm
                           text-[#e8e6df] placeholder-[#444] focus:outline-none focus:border-[#444]
                           transition-colors"
                style={{ background: '#0e0e0f', borderColor: '#2a2a2c' }}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full border rounded px-3 py-2.5 text-sm
                           text-[#e8e6df] placeholder-[#444] focus:outline-none focus:border-[#444]
                           transition-colors"
                style={{ background: '#0e0e0f', borderColor: '#2a2a2c' }}
              />
              <button
                type="submit"
                disabled={loading !== null || !username.trim() || !password}
                className="w-full px-4 py-2.5 rounded text-sm font-medium transition-colors disabled:opacity-40"
                style={{ background: '#80ff49', color: '#0e0e0f' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) e.currentTarget.style.background = '#9fff6e';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#80ff49')}
              >
                {loading === 'credentials' ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscordIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor">
      <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.9a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.6 37.6 0 0 0 25.6 1a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.9 4.9a.2.2 0 0 0-.1.1C1.6 18.2-.9 31 .3 43.6a.2.2 0 0 0 .1.2 58.8 58.8 0 0 0 17.7 9 .2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4 30.7 30.7 0 0 0 .6-.5.2.2 0 0 1 .2 0c11.6 5.3 24.1 5.3 35.5 0a.2.2 0 0 1 .2 0l.6.5a.2.2 0 0 1 0 .4 36.2 36.2 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47 47 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.6 58.6 0 0 0 17.8-9 .2.2 0 0 0 .1-.2C73 29.3 69.5 16.6 60.2 5a.2.2 0 0 0-.1-.1zM23.7 36.1c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
