// tests/hooks/useStickToBottom.test.ts
//
// Following a streaming answer without fighting the reader for the scrollbar.
//
// The page scrolled to the bottom on every state change, and a streaming answer
// changes state on every chunk — so scrolling up to re-read a paragraph got you
// dragged back down by the next token, with `behavior: 'smooth'` queued dozens
// of times a second. On a phone that is both janky and inescapable.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, act } from '@testing-library/react';
import { createElement, useState } from 'react';

import { useStickToBottom } from '@/components/ai/useStickToBottom';

/**
 * A scroll pane with a fixed viewport and a growing amount of content.
 *
 * jsdom lays nothing out, so scrollHeight and clientHeight are defined here and
 * scrollTop is a plain writable number — which is all the hook reads.
 */
function makePane(el: HTMLElement, contentHeight: number, viewport = 400) {
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => contentHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => viewport });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true, get: () => top, set: (v: number) => { top = v; },
  });
  el.scrollTo = ((opts: { top: number }) => { top = opts.top; }) as typeof el.scrollTo;
  return { setTop: (v: number) => { top = v; el.dispatchEvent(new Event('scroll')); } };
}

let pane: ReturnType<typeof makePane>;
let api: ReturnType<typeof useStickToBottom>;

/** Renders the hook over a pane of `content` pixels, with a bumpable dependency. */
function renderPane(content = 1000) {
  let bump = () => {};
  function Harness() {
    const [n, setN] = useState(0);
    bump = () => setN((v) => v + 1);
    api = useStickToBottom(n);
    return createElement('div', { ref: api.ref });
  }
  const view = render(createElement(Harness));
  const el = view.container.querySelector('div')!;
  pane = makePane(el, content);
  return { el, bump: () => act(() => { bump(); }) };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('useStickToBottom', () => {
  // WHY: The ordinary case — reading the newest message, following the stream.
  it('follows new content while the reader is at the bottom', () => {
    const { el, bump } = renderPane();
    pane.setTop(600);            // 1000 content − 400 viewport: the bottom.
    bump();
    expect(el.scrollTop).toBe(1000);
    expect(api.showJumpButton).toBe(false);
  });

  // WHY: This is the bug. Scroll up to re-read and the next streamed token used
  //      to drag you straight back down.
  it('leaves the view alone once the reader has scrolled away', () => {
    const { el, bump } = renderPane();
    pane.setTop(100);            // Well above the bottom.
    bump();
    expect(el.scrollTop).toBe(100);
  });

  // WHY: Not following silently would hide that the answer is still arriving.
  //      The reader gets told, and gets a way back.
  it('offers a way back to the newest message instead', () => {
    const { bump } = renderPane();
    pane.setTop(100);
    bump();
    expect(api.showJumpButton).toBe(true);
  });

  // WHY: Taking the way back has to re-arm following, or the reader has to keep
  //      pressing it for every remaining chunk of the same answer.
  it('re-arms following when the reader jumps to the latest', () => {
    const { el, bump } = renderPane();
    pane.setTop(100);
    bump();

    act(() => { api.jumpToLatest(); });
    expect(el.scrollTop).toBe(1000);
    expect(api.showJumpButton).toBe(false);

    bump();
    expect(el.scrollTop).toBe(1000);
  });

  // WHY: "At the bottom" cannot mean exactly at the bottom — a streaming answer
  //      is a few pixels taller than it was a moment ago, and a strict test
  //      would unstick itself on its own output.
  it('treats a few pixels short of the bottom as the bottom', () => {
    const { el, bump } = renderPane();
    pane.setTop(560);            // 40px shy of 600.
    bump();
    expect(el.scrollTop).toBe(1000);
  });

  // WHY: Scrolling back down is the other way to re-arm, and the more natural
  //      one — the button should get out of the way when it does.
  it('follows again when the reader scrolls back down themselves', () => {
    const { el, bump } = renderPane();
    pane.setTop(100);
    bump();
    expect(api.showJumpButton).toBe(true);

    act(() => { pane.setTop(600); });
    expect(api.showJumpButton).toBe(false);
    bump();
    expect(el.scrollTop).toBe(1000);
  });
});
