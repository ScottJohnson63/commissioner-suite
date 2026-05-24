// src/app/league/ai/page.tsx
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

type ModelUsed = 'gemini' | 'groq' | null;

interface SleeperLeague {
  leagueId: string;
  name: string;
  season: number;
  totalRosters: number;
  status: string;
}

interface SleeperUserData {
  userId: string;
  username: string;
  displayName: string;
  leagues: SleeperLeague[];
}

const HOURLY_LIMIT = 15;

const SUGGESTED_PROMPTS = [
  'Should I start or sit my running back this week?',
  'Who are the top waiver wire pickups right now?',
  'Which QBs are trending up this week?',
  'Should I trade for a receiver or focus on defense?',
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionAlert({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="w-full rounded-xl px-5 py-4 text-sm flex flex-col gap-2 relative"
      style={{ background: '#1a1a1c', border: '1px solid #2e2e30' }}
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span style={{ color: '#80ff49' }}>⚡</span>
          <span className="font-medium" style={{ color: '#e8e6df' }}>
            Session Limits Apply
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-xs leading-none mt-0.5 transition-colors"
          style={{ color: '#555' }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <p style={{ color: '#888' }}>
        You are limited to <strong style={{ color: '#e8e6df' }}>{HOURLY_LIMIT} prompts per hour</strong>.
        This agent is shared — please use it sparingly so everyone can access it.
        The agent uses <strong style={{ color: '#e8e6df' }}>Groq Llama 3.1</strong> by default and
        automatically switches to <strong style={{ color: '#e8e6df' }}>Gemini 2.5 Flash</strong> if the
        Groq rate limit is reached.
      </p>
    </div>
  );
}

function FallbackToast({ reason, onDismiss }: { reason: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const message = reason === 'groq_rate_limit'
    ? 'Groq rate limit reached — switched to'
    : 'Groq error — switched to';

  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm flex items-center gap-3 shadow-xl"
      style={{ background: '#1e1e20', border: '1px solid #3a3a3c', color: '#e8e6df', maxWidth: '90vw' }}
      role="status"
    >
      <span style={{ color: '#facc15' }}>⚠</span>
      <span>
        {message}{' '}
        <strong style={{ color: '#e8e6df' }}>Gemini 2.5 Flash</strong>
      </span>
      <button
        onClick={onDismiss}
        className="ml-1 text-xs transition-colors"
        style={{ color: '#555' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

function UsageBar({
  used,
  limit,
  dailyUsed,
}: {
  used: number;
  limit: number;
  dailyUsed: number;
}) {
  const pct = Math.min(100, (used / limit) * 100);
  const barColor =
    pct >= 100 ? '#ef4444' : pct >= 80 ? '#facc15' : '#80ff49';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs" style={{ color: '#555' }}>
        <span>{used}/{limit} prompts this hour</span>
        <span>{dailyUsed} used today</span>
      </div>
      <div
        className="h-1 w-full rounded-full overflow-hidden"
        style={{ background: '#1e1e20' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

function ModelBadge({ model }: { model: ModelUsed }) {
  const label = model === 'gemini' ? 'Gemini 2.5 Flash' : 'Llama 3.1 · Groq';
  const color = model === 'gemini' ? '#60a5fa' : '#80ff49';
  return (
    <span
      className="text-xs px-2 py-1 rounded transition-all"
      style={{ background: '#1a1a1c', color }}
    >
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Session alert (shown once on load)
  const [showAlert, setShowAlert] = useState(true);

  // Fallback toast
  const [showFallbackToast, setShowFallbackToast] = useState<string | null>(null);

  // Rate-limit / usage tracking (client-side mirror of server headers)
  const [hourlyUsed, setHourlyUsed] = useState(0);
  const [dailyUsed, setDailyUsed] = useState(0);
  const [modelUsed, setModelUsed] = useState<ModelUsed>('groq');
  const [rateLimited, setRateLimited] = useState(false);
  // Sleeper identity — persisted in localStorage
  const [sleeperUsername, setSleeperUsername] = useState('');
  const [sleeperUser, setSleeperUser] = useState<SleeperUserData | null>(null);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [activeLeagueName, setActiveLeagueName] = useState<string | null>(null);
  const [leagueInputOpen, setLeagueInputOpen] = useState(false);
  const [sleeperLoading, setSleeperLoading] = useState(false);
  const [sleeperError, setSleeperError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clientIdRef = useRef<string>('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore Sleeper identity from localStorage on mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('sleeper_username');
    const savedLeagueId = localStorage.getItem('sleeper_league_id');
    const savedLeagueName = localStorage.getItem('sleeper_league_name');
    if (savedUsername) setSleeperUsername(savedUsername);
    if (savedLeagueId) setActiveLeagueId(savedLeagueId);
    if (savedLeagueName) setActiveLeagueName(savedLeagueName);
  }, []);

  async function handleSleeperLookup(): Promise<void> {
    const username = sleeperUsername.trim().toLowerCase();
    if (!username) return;
    setSleeperLoading(true);
    setSleeperError(null);
    try {
      const res = await fetch(`/api/sleeper/user?username=${encodeURIComponent(username)}`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'User not found');
      }
      const data = (await res.json()) as SleeperUserData;
      setSleeperUser(data);
      // Store stable userId per Sleeper docs (username can change)
      localStorage.setItem('sleeper_user_id', data.userId);
      localStorage.setItem('sleeper_username', username);
      // Auto-select first league
      if (data.leagues.length > 0) {
        const first = data.leagues[0];
        setActiveLeagueId(first.leagueId);
        setActiveLeagueName(first.name);
        localStorage.setItem('sleeper_league_id', first.leagueId);
        localStorage.setItem('sleeper_league_name', first.name);
      }
    } catch (err) {
      setSleeperError(err instanceof Error ? err.message : 'Failed to load Sleeper data');
    } finally {
      setSleeperLoading(false);
    }
  }

  function handleLeagueSelect(leagueId: string, leagueName: string): void {
    setActiveLeagueId(leagueId);
    setActiveLeagueName(leagueName);
    localStorage.setItem('sleeper_league_id', leagueId);
    localStorage.setItem('sleeper_league_name', leagueName);
    setLeagueInputOpen(false);
  }

  function handleSleeperDisconnect(): void {
    setSleeperUser(null);
    setSleeperUsername('');
    setActiveLeagueId(null);
    setActiveLeagueName(null);
    localStorage.removeItem('sleeper_username');
    localStorage.removeItem('sleeper_user_id');
    localStorage.removeItem('sleeper_league_id');
    localStorage.removeItem('sleeper_league_name');
    setLeagueInputOpen(false);
  }

  useEffect(() => {
    let id = localStorage.getItem('agent_client_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('agent_client_id', id);
    }
    clientIdRef.current = id;
  }, []);

  const dismissFallbackToast = useCallback(() => setShowFallbackToast(null), []);

  async function handleSubmit(prompt?: string): Promise<void> {
    const text = (prompt ?? input).trim();
    if (!text || loading || rateLimited) return;

    const userMessage: Message = { role: 'user', content: text };
    const pendingMessage: Message = { role: 'assistant', content: '', loading: true };

    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    setInput('');
    setLoading(true);

    const history = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientIdRef.current,
        },
        body: JSON.stringify({ messages: history, sleeperLeagueId: activeLeagueId ?? undefined }),
      });

      // ── Handle rate-limit ──────────────────────────────────────────────────
      if (res.status === 429) {
        setRateLimited(true);
        const data = (await res.json()) as { error: string; resetAt?: number };
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `⛔ ${data.error}`,
            loading: false,
          };
          return updated;
        });
        return;
      }

      if (!res.ok || !res.body) {
        throw new Error('Agent failed to respond');
      }

      // ── Parse usage headers ────────────────────────────────────────────────
      const newModel = (res.headers.get('X-Model-Used') ?? null) as ModelUsed;
      const fallbackReason = res.headers.get('X-Fallback-Reason');
      const remaining = Number(res.headers.get('X-RateLimit-Remaining') ?? 0);
      const daily = Number(res.headers.get('X-Daily-Prompts-Used') ?? 0);

      setModelUsed(newModel);
      setHourlyUsed(HOURLY_LIMIT - remaining);
      setDailyUsed(daily);

      if (fallbackReason === 'groq_rate_limit') {
        setShowFallbackToast(fallbackReason);
      }

      // ── Stream text ────────────────────────────────────────────────────────
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: fullText,
            loading: false,
          };
          return updated;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Error: ${message}`,
          loading: false,
        };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <main
      className="h-full flex flex-col"
      style={{ color: '#e8e6df' }}
    >
      {/* ── Fallback toast ── */}
      {showFallbackToast && <FallbackToast reason={showFallbackToast} onDismiss={dismissFallbackToast} />}

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-4 sm:px-8 border-b shrink-0"
        style={{ borderColor: '#1e1e20' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" style={{ color: '#e8e6df' }}>
            AI Assistant
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Sleeper league selector */}
          <div className="relative">
            <button
              onClick={() => setLeagueInputOpen((v) => !v)}
              className="text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1.5"
              style={{
                background: '#141415',
                borderColor: activeLeagueId ? '#80ff49' : '#2a2a2c',
                color: activeLeagueId ? '#80ff49' : '#555',
              }}
            >
              {activeLeagueName ?? 'Connect Sleeper'}
              <span style={{ fontSize: '9px' }}>{leagueInputOpen ? '▲' : '▼'}</span>
            </button>

            {leagueInputOpen && (
              <div
                className="absolute right-0 top-8 z-50 rounded-xl p-4 flex flex-col gap-3 w-72 shadow-xl"
                style={{ background: '#141415', border: '1px solid #2a2a2c' }}
              >
                <p className="text-xs font-medium" style={{ color: '#e8e6df' }}>
                  Sleeper Account
                </p>

                {/* Username input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sleeperUsername}
                    onChange={(e) => setSleeperUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSleeperLookup()}
                    placeholder="Sleeper username"
                    className="flex-1 text-xs px-3 py-2 rounded-lg bg-transparent outline-none border"
                    style={{ borderColor: '#2a2a2c', color: '#e8e6df' }}
                  />
                  <button
                    onClick={() => void handleSleeperLookup()}
                    disabled={sleeperLoading || !sleeperUsername.trim()}
                    className="text-xs px-3 py-2 rounded-lg transition-colors font-medium"
                    style={{
                      background: sleeperLoading || !sleeperUsername.trim() ? '#1e1e20' : '#80ff49',
                      color: sleeperLoading || !sleeperUsername.trim() ? '#444' : '#0e0e0f',
                    }}
                  >
                    {sleeperLoading ? '…' : 'Go'}
                  </button>
                </div>

                {sleeperError && (
                  <p className="text-xs" style={{ color: '#ef4444' }}>{sleeperError}</p>
                )}

                {/* League dropdown */}
                {sleeperUser && sleeperUser.leagues.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs" style={{ color: '#555' }}>
                      {sleeperUser.displayName}'s leagues
                    </p>
                    {sleeperUser.leagues.map((league) => (
                      <button
                        key={league.leagueId}
                        onClick={() => handleLeagueSelect(league.leagueId, league.name)}
                        className="text-left text-xs px-3 py-2 rounded-lg transition-colors"
                        style={{
                          background: activeLeagueId === league.leagueId ? '#1a2a1a' : '#1a1a1c',
                          color: activeLeagueId === league.leagueId ? '#80ff49' : '#888',
                          border: `1px solid ${activeLeagueId === league.leagueId ? '#80ff49' : '#2a2a2c'}`,
                        }}
                      >
                        <span className="block font-medium" style={{ color: activeLeagueId === league.leagueId ? '#80ff49' : '#e8e6df' }}>
                          {league.name}
                        </span>
                        <span style={{ color: '#555' }}>
                          {league.totalRosters} teams · {league.season}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {sleeperUser && (
                  <button
                    onClick={handleSleeperDisconnect}
                    className="text-xs transition-colors"
                    style={{ color: '#555' }}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            )}
          </div>

          <ModelBadge model={modelUsed} />
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {/* Session alert */}
          {showAlert && (
            <SessionAlert onDismiss={() => setShowAlert(false)} />
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 mt-8">
              <div className="text-center">
                <div className="text-4xl mb-3" style={{ filter: 'grayscale(0.2)' }}>
                  🏈
                </div>
                <h1 className="text-xl font-medium mb-1">Fantasy Football AI</h1>
                <p className="text-sm" style={{ color: '#666' }}>
                  Ask anything about your lineup, waiver wire, or trade strategy.
                </p>
              </div>

              {/* Suggested prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => void handleSubmit(p)}
                    className="text-left px-4 py-3 rounded-lg text-sm border transition-colors"
                    style={{
                      background: '#141415',
                      borderColor: '#2a2a2c',
                      color: '#888',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#80ff49';
                      e.currentTarget.style.color = '#80ff49';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#2a2a2c';
                      e.currentTarget.style.color = '#888';
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 mt-1"
                  style={{ background: '#80ff49', color: '#0e0e0f' }}
                >
                  AI
                </div>
              )}

              <div
                className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: '#1e1e20', color: '#e8e6df' }
                    : { background: 'transparent', color: '#e8e6df' }
                }
              >
                {msg.loading ? (
                  <span style={{ color: '#555' }}>Thinking…</span>
                ) : (
                  <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input area ── */}
      <div
        className="px-4 pb-6 sm:px-8"
        style={{ borderTop: '1px solid #1e1e20', paddingTop: '1rem' }}
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          {/* Usage bar */}
          <UsageBar used={hourlyUsed} limit={HOURLY_LIMIT} dailyUsed={dailyUsed} />

          {/* Input row */}
          <div
            className="flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: '#141415', border: '1px solid #2a2a2c' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                rateLimited
                  ? 'Hourly limit reached — try again later'
                  : 'Ask about your lineup, trades, or waiver wire…'
              }
              disabled={loading || rateLimited}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm outline-none"
              style={{
                color: rateLimited ? '#555' : '#e8e6df',
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            />
            <button
              onClick={() => void handleSubmit()}
              disabled={!input.trim() || loading || rateLimited}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors"
              style={{
                background:
                  !input.trim() || loading || rateLimited ? '#1e1e20' : '#80ff49',
                color:
                  !input.trim() || loading || rateLimited ? '#444' : '#0e0e0f',
              }}
              aria-label="Send"
            >
              ↑
            </button>
          </div>

          <p className="text-center text-xs" style={{ color: '#333' }}>
            AI responses may be inaccurate. Verify important decisions independently.
          </p>
          <p className="text-center text-xs" style={{ color: '#60a5fa' }}>
            Trending data provided by{' '}
            <a
              href="https://sleeper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline transition-colors"
              style={{ color: '#60a5fa' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#93c5fd'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#60a5fa'; }}
            >
              Sleeper
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}