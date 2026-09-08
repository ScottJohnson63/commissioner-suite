// tests/hooks/useChatViewport.test.ts
//
// What a chat needs from a phone that a scrollable page does not.
//
// The portal's scroll pane leaves a band at the bottom for the floating nav
// button to hover in. That is right for a page of rows and wrong for a chat: it
// parked the composer 96px up with an empty strip underneath, which is what the
// issue meant by "align the chat window with a mobile framework". These pin the
// claim on that band, the handover to the nav button, and the cleanup — a page
// that kept the band after unmounting would break every other page.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, renderHook } from '@testing-library/react';
import { createElement, createRef, useRef } from 'react';

import { useChatViewport } from '@/components/ai/useChatViewport';

const root = () => document.documentElement;
const varOf = (name: string) => root().style.getPropertyValue(name);

/**
 * The hook as the page uses it: the column ref on a real element.
 *
 * `renderHook` alone leaves that ref null through the first effects, and the
 * keyboard listener quite correctly declines to attach to nothing. In the page
 * the ref is on `<main>` and React has set it before any effect runs, so the
 * harness has to render an element too.
 */
function renderChat() {
  function Harness() {
    const bar = useRef<HTMLDivElement>(null);
    const column = useChatViewport(bar);
    return createElement('main', { ref: column }, createElement('div', { ref: bar }));
  }
  const view = render(createElement(Harness));
  return { view, column: view.container.querySelector('main')! };
}

/** A composer of a given height, as the page's bottom bar. */
function barRef(height: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = el;
  return ref;
}

/** A visual viewport of the given height inside an 844px layout viewport. */
function stubViewport(height: number) {
  const listeners: Record<string, () => void> = {};
  const vv = {
    height, offsetTop: 0,
    addEventListener: (e: string, fn: () => void) => { listeners[e] = fn; },
    removeEventListener: () => {},
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  return {
    /** Moves the viewport as the keyboard opening or closing would. */
    setHeight(next: number) { vv.height = next; listeners.resize?.(); },
  };
}

beforeEach(() => {
  root().style.removeProperty('--app-main-pad-bottom');
  root().style.removeProperty('--app-bottom-bar-height');
});

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
});

describe('useChatViewport', () => {
  // WHY: The 96px band under the composer was the whole complaint. A chat wants
  //      the bottom of the screen, and this is how it asks for it.
  it('claims the scroll pane\'s bottom band while it is mounted', () => {
    renderHook(() => useChatViewport(barRef(150)));
    expect(varOf('--app-main-pad-bottom')).toBe('0px');
  });

  // WHY: The band exists so the floating nav button never lands on the last row
  //      of a page. Taking it back without telling the button how far to step up
  //      would put it straight on top of the send key.
  it('publishes the composer height for the nav button to clear', () => {
    renderHook(() => useChatViewport(barRef(142)));
    expect(varOf('--app-bottom-bar-height')).toBe('142px');
  });

  // WHY: Every other page in the portal still wants the band. A variable left
  //      behind on the document outlives the page that set it.
  it('gives the band back on unmount', () => {
    const { unmount } = renderHook(() => useChatViewport(barRef(150)));
    expect(varOf('--app-main-pad-bottom')).toBe('0px');

    unmount();
    expect(varOf('--app-main-pad-bottom')).toBe('');
    expect(varOf('--app-bottom-bar-height')).toBe('');
  });

  // WHY: `100dvh` accounts for the browser's toolbars and says nothing about a
  //      keyboard, so without this the composer ends up behind one. The visual
  //      viewport is the only thing that knows.
  it('shortens the column by however much the keyboard covers', () => {
    stubViewport(508);
    const { column } = renderChat();
    // 844 visible minus 508 still visible: the keyboard has 336 of it.
    expect(column.style.getPropertyValue('--kb-inset')).toBe('336px');
  });

  // WHY: The composer has to come back down when the keyboard closes, or the
  //      chat keeps a keyboard's worth of dead space for the rest of the session.
  it('gives the height back when the keyboard closes', () => {
    const listeners = stubViewport(508);
    const { column } = renderChat();
    expect(column.style.getPropertyValue('--kb-inset')).toBe('336px');

    listeners.setHeight(844);
    expect(column.style.getPropertyValue('--kb-inset')).toBe('0px');
  });

  // WHY: A negative inset would grow the column past the screen, and the
  //      sub-pixel noise these two numbers carry is enough to produce one.
  it('never reports a negative inset', () => {
    stubViewport(844.4);
    const { column } = renderChat();
    expect(column.style.getPropertyValue('--kb-inset')).toBe('0px');
  });

  // WHY: A browser without the visual viewport must still render a chat, just
  //      without the keyboard handling.
  it('does nothing when the browser has no visual viewport', () => {
    expect(() => renderChat()).not.toThrow();
    expect(() => renderHook(() => useChatViewport(barRef(142)))).not.toThrow();
  });
});
