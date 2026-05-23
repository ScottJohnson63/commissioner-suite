// src/app/league/ai/page.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

const SUGGESTED_PROMPTS = [
  'Should I start or sit my running back this week?',
  'Who are the top waiver wire pickups right now?',
  'Which QBs are trending up this week?',
  'Should I trade for a receiver or focus on defense?',
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(prompt?: string): Promise<void> {
    const text = (prompt ?? input).trim();
    if (!text || loading) return;

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Agent failed to respond');
      }

      // Read the stream
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
      className="min-h-screen flex flex-col"
      style={{ background: '#0e0e0f', color: '#e8e6df' }}
    >
      {/* ── Header */}
      <div
        className="flex items-center justify-between px-4 py-4 sm:px-8 border-b"
        style={{ borderColor: '#1e1e20' }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-xs transition-colors"
            style={{ color: '#555' }}
          >
            ← Dashboard
          </Link>
          <span style={{ color: '#2a2a2c' }}>|</span>
          <span className="text-sm font-medium" style={{ color: '#e8e6df' }}>
            AI Assistant
          </span>
        </div>
        <span
          className="text-xs px-2 py-1 rounded"
          style={{ background: '#1a1a1c', color: '#80ff49' }}
        >
          Llama 3.3 · Groq
        </span>
      </div>

      {/* ── Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 mt-12">
              <div className="text-center">
                <div
                  className="text-4xl mb-3"
                  style={{ filter: 'grayscale(0.2)' }}
                >
                  🏈
                </div>
                <h1 className="text-xl font-medium mb-1">Fantasy Football AI</h1>
                <p className="text-sm" style={{ color: '#666' }}>
                  Ask anything about your lineup, waiver wire, or trade strategy.
                </p>
              </div>

              {/* Suggested prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void handleSubmit(prompt)}
                    className="text-left px-4 py-3 rounded-lg text-sm border transition-colors"
                    style={{
                      background: '#141415',
                      borderColor: '#2a2a2c',
                      color: '#888',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#444';
                      e.currentTarget.style.color = '#e8e6df';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#2a2a2c';
                      e.currentTarget.style.color = '#888';
                    }}
                  >
                    {prompt}
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
                  <span
                    className="inline-block w-4 h-4 rounded-full animate-pulse"
                    style={{ background: '#80ff49', opacity: 0.6 }}
                  />
                ) : (
                  <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                )}
              </div>

              {msg.role === 'user' && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 mt-1"
                  style={{ background: '#2a2a2c', color: '#888' }}
                >
                  U
                </div>
              )}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input */}
      <div
        className="border-t px-4 py-4 sm:px-8"
        style={{ borderColor: '#1e1e20', background: '#0e0e0f' }}
      >
        <div className="max-w-2xl mx-auto flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your lineup, trades, waiver wire…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none border transition-colors disabled:opacity-50"
            style={{
              background: '#141415',
              borderColor: '#2a2a2c',
              color: '#e8e6df',
              minHeight: '44px',
              maxHeight: '120px',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#444')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2a2c')}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={() => void handleSubmit()}
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 shrink-0"
            style={{ background: '#80ff49', color: '#0e0e0f' }}
            onMouseEnter={(e) => {
              if (!loading && input.trim())
                e.currentTarget.style.background = '#9fff6e';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#80ff49';
            }}
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
        <p className="text-center text-xs mt-2" style={{ color: '#333' }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </main>
  );
}