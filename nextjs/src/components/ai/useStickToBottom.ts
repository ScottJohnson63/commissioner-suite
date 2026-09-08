'use client';

// src/components/ai/useStickToBottom.ts
//
// Following a streaming answer without fighting the reader for the scrollbar.
//
// The page scrolled to the bottom on every state change, and a streaming answer
// changes state on every chunk. Scroll up to re-read the paragraph above and the
// next token drags you back down — with `behavior: 'smooth'` queued dozens of
// times a second, which on a phone is both janky and impossible to escape.
//
// So: follow the bottom only while the reader is already at the bottom. The
// moment they scroll away, stop, and offer them a way back instead.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How far from the bottom still counts as "at the bottom", in pixels. */
const STICK_THRESHOLD = 64;

export interface StickToBottom {
  /** Attach to the scrolling element. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** True when the reader has scrolled away and is missing new content. */
  showJumpButton: boolean;
  /** Scrolls to the newest message and re-arms following. */
  jumpToLatest: () => void;
}

/**
 * @param dependency  Anything whose change means new content — the transcript.
 */
export function useStickToBottom(dependency: unknown): StickToBottom {
  const ref = useRef<HTMLDivElement | null>(null);
  const stuck = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const atBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;

  // Whether we are following is the reader's decision, made by scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => {
      stuck.current = atBottom(el);
      setShowJumpButton(!stuck.current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // New content: follow it, or leave a button saying there is some.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stuck.current) {
      // `auto`, not `smooth`: this runs once per streamed chunk, and a queue of
      // smooth scrolls never catches up with the text producing them.
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJumpButton(true);
    }
  }, [dependency]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stuck.current = true;
    setShowJumpButton(false);
  }, []);

  return { ref, showJumpButton, jumpToLatest };
}
