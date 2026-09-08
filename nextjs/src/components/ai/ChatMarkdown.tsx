'use client';

// src/components/ai/ChatMarkdown.tsx
//
// The small slice of Markdown the assistant actually writes.
//
// The answers have always come back as Markdown — the model is asked for bold
// verdicts and bulleted support — and the page rendered them inside a
// `white-space: pre-wrap` span, so a reader on a phone got a wall of asterisks
// and hyphens. The issue that prompted this quoted one verbatim.
//
// It parses rather than injects: every node below is a React element built from
// matched text, so a model that emits `<script>` emits four visible characters.
// A Markdown dependency would do more, and none of the rest of it — tables,
// images, footnotes, raw HTML — is anything the assistant is asked to produce.

import React from 'react';

const ACCENT = '#80ff49';

// ─── Inline ───────────────────────────────────────────────────────────────────

// Bold, italic and code, longest delimiter first so `**a**` is not read as two
// italics. Ordinary asterisks in prose (a footnote marker, a stray one) match
// nothing here and survive as themselves.
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|`[^`\n]+`)/g;

/** Splits one line into bold / italic / code / plain runs. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={key} style={{ color: '#ffffff', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="px-1 py-0.5 rounded text-[0.9em]"
          style={{ background: '#1e1e20', color: ACCENT }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

// ─── Block ────────────────────────────────────────────────────────────────────

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET  = /^\s*[-*•]\s+(.*)$/;
const NUMBER  = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/**
 * Groups lines into blocks.
 *
 * A blank line ends a paragraph; a bullet or a number starts a list and any
 * run of them stays one list. Streaming makes this run on every chunk, so it is
 * a single pass with no lookahead — a half-written line is simply a shorter
 * paragraph until the rest of it arrives.
 */
function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;

  const close = () => { if (open) { blocks.push(open); open = null; } };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();

    if (!line.trim()) { close(); continue; }

    const heading = HEADING.exec(line);
    if (heading) { close(); blocks.push({ kind: 'h', text: heading[1] }); continue; }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (open?.kind !== 'ul') { close(); open = { kind: 'ul', items: [] }; }
      open.items.push(bullet[1]);
      continue;
    }

    const numbered = NUMBER.exec(line);
    if (numbered) {
      if (open?.kind !== 'ol') { close(); open = { kind: 'ol', items: [] }; }
      open.items.push(numbered[1]);
      continue;
    }

    if (open?.kind !== 'p') { close(); open = { kind: 'p', lines: [] }; }
    open.lines.push(line);
  }
  close();
  return blocks;
}

/** Renders the assistant's Markdown. Safe by construction — nothing is injected. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parse(text);

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          return (
            <p key={i} className="text-sm font-semibold" style={{ color: '#ffffff' }}>
              {inline(b.text, `h${i}`)}
            </p>
          );
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          const Tag = b.kind === 'ul' ? 'ul' : 'ol';
          return (
            <Tag key={i} className="flex flex-col gap-1.5 pl-1">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span
                    className="shrink-0 select-none"
                    style={{ color: ACCENT, minWidth: b.kind === 'ol' ? '1.1em' : undefined }}
                    aria-hidden
                  >
                    {b.kind === 'ol' ? `${j + 1}.` : '•'}
                  </span>
                  <span className="min-w-0">{inline(item, `i${i}-${j}`)}</span>
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, `p${i}-${j}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
