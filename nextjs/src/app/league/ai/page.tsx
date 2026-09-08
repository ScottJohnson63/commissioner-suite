// src/app/league/ai/page.tsx
//
// The assistant, as a chat the page is shaped around rather than a panel that
// happens to contain one.
//
// Three things drive the layout. The column is exactly as tall as the pane it
// sits in and only the transcript scrolls, so the composer stays under the
// thumb on a phone instead of being chased off the bottom by a long answer.
// Answers arrive as Markdown and are rendered as Markdown — see ChatMarkdown —
// because the raw asterisks were most of what a phone screen showed. And the
// hour's allowance is read back from the server on load rather than assumed
// spent-nothing; see useAgentUsage.

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useSleeperData } from '@/hooks/useSleeperData';
import { LeagueSelector } from '@/components/LeagueSelector';
import { ChatMarkdown } from '@/components/ai/ChatMarkdown';
import { useAgentUsage } from '@/components/ai/useAgentUsage';
import { useChatViewport } from '@/components/ai/useChatViewport';
import { useStickToBottom } from '@/components/ai/useStickToBottom';
import type { AgentUsage } from '@/components/ai/useAgentUsage';
import { SUGGESTED_PROMPTS } from '@/lib/agentIntents';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  /** Which of the league panels fed this answer, from X-Panel-Data. */
  sources?: string[];
}

type ModelUsed = 'gemini' | 'groq' | null;

const ALERT_DISMISSED_KEY = 'agent_alert_dismissed';

const PANEL_LABEL: Record<string, string> = {
  matchup: 'Matchup Analysis',
  waivers: 'Waiver Wire',
  trades:  'Trade Analyzer',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionAlert({ limit, dailyLimit, onDismiss }: {
  limit: number; dailyLimit: number; onDismiss: () => void;
}) {
  return (
    <div
      className="w-full rounded-xl px-4 py-3.5 sm:px-5 sm:py-4 text-sm flex flex-col gap-2"
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
          className="shrink-0 text-xs leading-none -m-2 p-2 transition-colors"
          style={{ color: '#555' }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <p style={{ color: '#888' }}>
        You are limited to <strong style={{ color: '#e8e6df' }}>{limit} prompts per hour</strong>,
        and the league shares <strong style={{ color: '#e8e6df' }}>{dailyLimit} a day</strong>.
        Please use it sparingly so everyone can access it.
        The agent answers on <strong style={{ color: '#e8e6df' }}>Gemini</strong> and
        falls back to <strong style={{ color: '#e8e6df' }}>Groq</strong> if Gemini is
        rate-limited or unavailable.
      </p>
    </div>
  );
}

function FallbackToast({ reason, onDismiss }: { reason: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  // Whichever provider led, the toast names the one that actually answered —
  // and says why the other did not, because "the assistant is slow today" and
  // "your primary key is revoked" look identical from the reader's chair.
  const FALLBACK_MESSAGE: Record<string, string> = {
    gemini_error:          'Gemini error — switched to',
    gemini_unavailable:    'Gemini is not configured — using',
    groq_rate_limit:       'Groq rate limit reached — switched to',
    groq_unavailable:      'Groq is not configured — using',
    groq_prompt_too_large: 'Too much data for Groq this minute — using',
    groq_error:            'Groq error — switched to',
  };
  const message = FALLBACK_MESSAGE[reason] ?? 'Switched to';
  const answered = reason.startsWith('gemini') ? 'Groq' : 'Gemini';

  return (
    // A row of the composer rather than a floating pill. Pinned to the viewport
    // it had to guess how tall the composer was, and on a phone — where the
    // layout lifts the whole column clear of the floating nav button — the
    // guess landed on top of the input it was talking about.
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs"
      style={{ background: '#1e1e20', border: '1px solid #3a3a3c', color: '#c9c7c1' }}
      role="status"
    >
      <span className="shrink-0" style={{ color: '#facc15' }}>⚠</span>
      <span className="min-w-0 flex-1">
        {message} <strong style={{ color: '#e8e6df' }}>{answered}</strong>
      </span>
      <button
        onClick={onDismiss}
        className="shrink-0 -m-2 p-2 leading-none transition-colors"
        style={{ color: '#555' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

/** "resets in 42m" — the half of a rate limit a bar cannot show. */
function resetLabel(resetAt: number): string {
  const mins = Math.ceil((resetAt - Date.now()) / 60000);
  if (mins <= 0) return 'resets now';
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.round(mins / 60);
  return `resets in ${hours}h`;
}

/**
 * Two budgets, one bar.
 *
 * The reader's own hour and the app's shared day run out independently, and the
 * bar shows whichever is closer to gone — being told 3/15 while the app has
 * nothing left for anyone is the confusion this exists to avoid.
 */
function UsageBar({ usage, dayExhausted }: { usage: AgentUsage; dayExhausted: boolean }) {
  const hourPct = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
  const dayPct  = usage.dailyLimit > 0 ? (usage.dailyUsed / usage.dailyLimit) * 100 : 0;
  const pct = Math.min(100, Math.max(hourPct, dayPct));
  const barColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#facc15' : '#80ff49';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs" style={{ color: '#555' }}>
        <span className="truncate">
          {dayExhausted
            ? `Shared daily limit reached · ${resetLabel(usage.dailyResetAt)}`
            : `${usage.used}/${usage.limit} this hour · ${resetLabel(usage.resetAt)}`}
        </span>
        <span className="shrink-0">{usage.dailyUsed}/{usage.dailyLimit} today</span>
      </div>
      <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: '#1e1e20' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

function ModelBadge({ model, modelId }: { model: ModelUsed; modelId: string | null }) {
  // The server discovers the Groq model at request time, so the badge reports
  // the ID that actually answered rather than a name baked in here.
  const provider = model === 'gemini' ? 'Gemini' : 'Groq';
  const label = modelId ? `${modelId} · ${provider}` : provider;
  const color = model === 'gemini' ? '#60a5fa' : '#80ff49';
  return (
    <span
      className="shrink-0 text-xs px-2 py-1 rounded truncate max-w-[45vw] sm:max-w-none"
      style={{ background: '#1a1a1c', color }}
      title={`Answered by ${provider}${modelId ? ` (${modelId})` : ''}`}
    >
      {label}
    </span>
  );
}

/** Which league panels an answer was built from — the "roped in" made visible. */
function SourceChips({ sources }: { sources: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.map((s) => (
        <span
          key={s}
          className="text-[11px] px-2 py-0.5 rounded-full"
          style={{ background: '#16171a', border: '1px solid #26272b', color: '#7d7d78' }}
        >
          {PANEL_LABEL[s] ?? s}
        </span>
      ))}
    </div>
  );
}

/** Three dots, so a slow first token reads as work rather than as a hang. */
function Thinking() {
  return (
    <span className="inline-flex items-center gap-1" style={{ color: '#555' }} aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: '#555',
            animation: 'agentDot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
      <style>{'@keyframes agentDot{0%,60%,100%{opacity:.25}30%{opacity:1}}'}</style>
    </span>
  );
}

/**
 * Pulls a human-readable reason out of a failed /api/agent response.
 *
 * The route answers errors as `{ error: string }`, so the user gets the real
 * cause — an unconfigured key, an upstream provider outage, an expired session —
 * instead of a blanket "Agent failed to respond" that hides all three. Falls
 * back to the status code when the body is not JSON (e.g. a proxy error page).
 */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // Body was empty or not JSON — fall through to the status-based message.
  }
  if (res.status === 401) return 'Your session has expired. Please sign in again.';
  if (res.status === 503) return 'The AI service is not configured on the server.';
  return `The assistant is unavailable right now (HTTP ${res.status}).`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIPage() {
  useSession();
  const { sleeperUser, activeLeagueId, setActiveLeagueId } = useSleeperData();
  const { usage, exhausted, dayExhausted, clientId, recordResponse, recordRejection } = useAgentUsage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Dismissing the notice is remembered — it says the same thing every visit,
  // and the meter under the composer says the live half of it anyway.
  const [showAlert, setShowAlert] = useState(false);
  const [showFallbackToast, setShowFallbackToast] = useState<string | null>(null);

  const [modelUsed, setModelUsed] = useState<ModelUsed>('gemini');
  const [modelId, setModelId] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The composer is the page's bottom bar: it claims the band the floating nav
  // button hovers in, and publishes its height so the button steps up over it.
  const composerRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useChatViewport(composerRef);
  const {
    ref: transcriptRef, showJumpButton: showJumpToLatest, jumpToLatest,
  } = useStickToBottom(messages);

  // Read after mount, not during render: localStorage does not exist on the
  // server, and a value read during render would be a hydration mismatch.
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(ALERT_DISMISSED_KEY) === '1'; } catch { /* no storage */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowAlert(!dismissed);
  }, []);

  const dismissAlert = useCallback(() => {
    setShowAlert(false);
    try { localStorage.setItem(ALERT_DISMISSED_KEY, '1'); } catch { /* not essential */ }
  }, []);

  const dismissFallbackToast = useCallback(() => setShowFallbackToast(null), []);

  /** Keeps the composer one line tall until the text needs more, then grows. */
  function resize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  async function handleSubmit(prompt?: string): Promise<void> {
    const text = (prompt ?? input).trim();
    if (!text || loading || exhausted) return;

    const userMessage: Message = { role: 'user', content: text };
    const pendingMessage: Message = { role: 'assistant', content: '', loading: true };

    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    setInput('');
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
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
          'X-Client-Id': clientId,
        },
        body: JSON.stringify({ messages: history, sleeperLeagueId: activeLeagueId ?? undefined }),
      });

      // ── Handle rate-limit ──────────────────────────────────────────────────
      if (res.status === 429) {
        const data = (await res.json()) as { error: string; resetAt?: number };
        // The daily 429 is the app's budget, not this reader's hour. The header
        // says which, so the meter and the composer can say the right thing.
        const daily = Number(res.headers.get('X-Daily-Prompts-Used') ?? 0)
          >= Number(res.headers.get('X-Daily-Limit') ?? Infinity);
        recordRejection(data.resetAt, daily ? 'daily' : 'hourly');
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

      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      if (!res.body) {
        throw new Error('The assistant returned an empty response. Please try again.');
      }

      // ── Parse usage headers ────────────────────────────────────────────────
      setModelUsed((res.headers.get('X-Model-Used') ?? null) as ModelUsed);
      setModelId(res.headers.get('X-Model-Id'));
      recordResponse(res.headers);

      const panels = (res.headers.get('X-Panel-Data') ?? 'none')
        .split(',')
        .filter((p) => p && p !== 'none');
      if (panels.length) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], sources: panels };
          return updated;
        });
      }

      const fallbackReason = res.headers.get('X-Fallback-Reason');
      if (fallbackReason) setShowFallbackToast(fallbackReason);

      // ── Stream text ────────────────────────────────────────────────────────
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + chunk,
            loading: false,
          };
          return updated;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      setMessages((prev) => {
        const updated = [...prev];
        // Preserve any text that already streamed in — a failure partway
        // through should not wipe out the answer the user was reading.
        const partial = updated[updated.length - 1]?.content ?? '';
        updated[updated.length - 1] = {
          role: 'assistant',
          content: partial ? `${partial}\n\nError: ${message}` : `Error: ${message}`,
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
    // Enter sends on a real keyboard. On a phone it inserts a newline — a
    // software keyboard's return key is where the reader reaches for one, and
    // sending a half-written question instead is the mistake that follows.
    const coarse = typeof window !== 'undefined'
      && window.matchMedia?.('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const canSend = Boolean(input.trim()) && !loading && !exhausted;

  return (
    // `--kb-inset` is however much of the viewport the software keyboard is
    // covering, kept current by useChatViewport. Subtracting it is what puts the
    // composer above the keyboard instead of behind it.
    <main
      ref={columnRef as React.RefObject<HTMLElement>}
      className="flex flex-col min-h-0"
      style={{ color: '#e8e6df', height: 'calc(100% - var(--kb-inset, 0px))' }}
    >
      {/* ── Header ──
          One row on every width. The model badge moved down beside the usage
          meter: on a phone this row is a title, a league name and a model ID,
          and the model ID is the one of the three nobody came here for. */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-4 border-b shrink-0"
        style={{ borderColor: '#1e1e20' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden>🏈</span>
          <span className="text-sm font-medium truncate" style={{ color: '#e8e6df' }}>
            AI Assistant
          </span>
        </div>
        <LeagueSelector
          sleeperUser={sleeperUser}
          activeLeagueId={activeLeagueId}
          onSelect={setActiveLeagueId}
          className="shrink-0 max-w-[55%]"
        />
      </div>

      {/* ── Messages ──
          `min-h-0` is what makes this the only thing that scrolls: without it a
          flex child refuses to shrink below its content and the whole column
          grows instead, taking the composer off the bottom of the screen. */}
      <div
        ref={transcriptRef}
        className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-6"
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-5 sm:gap-6">

          {showAlert && (
            <SessionAlert limit={usage.limit} dailyLimit={usage.dailyLimit} onDismiss={dismissAlert} />
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 mt-2 sm:mt-6">
              <div className="text-center">
                <h1 className="text-lg sm:text-xl font-medium mb-1">Fantasy Football AI</h1>
                <p className="text-sm" style={{ color: '#666' }}>
                  {activeLeagueId
                    ? 'Ask about your lineup, the waiver wire, or a trade — it reads your roster.'
                    : 'Pick a league above and it can answer for your actual roster.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                {SUGGESTED_PROMPTS.map(({ text }) => (
                  <button
                    key={text}
                    onClick={() => void handleSubmit(text)}
                    disabled={loading || exhausted}
                    className="text-left px-4 py-3 rounded-xl text-sm border transition-colors disabled:opacity-50"
                    style={{ background: '#141415', borderColor: '#2a2a2c', color: '#9a9a94' }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 mt-0.5"
                  style={{ background: '#80ff49', color: '#0e0e0f' }}
                  aria-hidden
                >
                  AI
                </div>
              )}

              <div
                className={`text-sm leading-relaxed min-w-0 ${
                  msg.role === 'user'
                    ? 'max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md'
                    : 'max-w-[calc(100%-2.5rem)] sm:max-w-[85%]'
                }`}
                style={
                  msg.role === 'user'
                    ? { background: '#1e1e20', color: '#e8e6df' }
                    : { color: '#d8d6cf' }
                }
              >
                {msg.loading
                  ? <Thinking />
                  : msg.role === 'user'
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                    : <ChatMarkdown text={msg.content} />}
                {msg.role === 'assistant' && !msg.loading && msg.sources?.length
                  ? <SourceChips sources={msg.sources} />
                  : null}
              </div>
            </div>
          ))}

        </div>
      </div>

      {/* ── Composer ── */}
      <div
        ref={composerRef}
        className="relative shrink-0 px-4 sm:px-8"
        style={{
          borderTop: '1px solid #1e1e20',
          paddingTop: '0.75rem',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
        }}
      >
        {/* Scrolled away from a streaming answer — the way back, rather than
            being dragged there by the next token. */}
        {showJumpToLatest && (
          <button
            onClick={jumpToLatest}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5
                       rounded-full text-xs shadow-lg transition-colors"
            style={{ top: -44, background: '#1e1e20', border: '1px solid #3a3a3c', color: '#c9c7c1' }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" />
            </svg>
            Latest
          </button>
        )}

        <div className="max-w-2xl mx-auto flex flex-col gap-2.5">
          {showFallbackToast && (
            <FallbackToast reason={showFallbackToast} onDismiss={dismissFallbackToast} />
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <UsageBar usage={usage} dayExhausted={dayExhausted} />
            </div>
            <ModelBadge model={modelUsed} modelId={modelId} />
          </div>

          <div
            className="flex items-end gap-2 rounded-2xl px-3 py-2 sm:px-4 sm:py-3"
            style={{ background: '#141415', border: '1px solid #2a2a2c' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); resize(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder={
                dayExhausted
                  ? `Shared daily limit reached — ${resetLabel(usage.dailyResetAt)}`
                  : exhausted
                  ? `Hourly limit reached — ${resetLabel(usage.resetAt)}`
                  // Short enough to sit on one line at 16px on a small phone —
                  // a wrapped placeholder is clipped by a one-row textarea.
                  : 'Ask anything about your team…'
              }
              disabled={loading || exhausted}
              rows={1}
              aria-label="Message the assistant"
              // 16px on a phone, deliberately: iOS Safari zooms the whole page
              // in on any focused field below that, and never zooms back out.
              className="flex-1 resize-none bg-transparent outline-none text-base sm:text-sm py-1.5"
              style={{
                color: exhausted ? '#555' : '#e8e6df',
                maxHeight: '140px',
                overflowY: 'auto',
              }}
            />
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSend}
              // 44px on a phone: the smallest target a thumb hits reliably, and
              // the one control on this page that a mis-tap costs a prompt from
              // a limited hourly allowance. A pointer does not need the room.
              className="shrink-0 rounded-full flex items-center justify-center transition-colors
                         w-11 h-11 sm:w-9 sm:h-9"
              style={{
                background: canSend ? '#80ff49' : '#1e1e20',
                color: canSend ? '#0e0e0f' : '#444',
              }}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            </button>
          </div>

          {/* One line. Two of them cost 4% of a phone screen to say something
              nobody reads twice, and the screen is the composer's to give. */}
          <p className="text-center text-[11px] leading-none" style={{ color: '#3a3a38' }}>
            AI can be wrong — verify. Data by{' '}
            <a
              href="https://sleeper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: '#4a6a8a' }}
            >
              Sleeper
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
