// tests/components/WhatsNewDialog.test.tsx
//
// The What's New dialog (issue #71): when it opens by itself, what it shows,
// and how a member gets it back.
//
// The rules pinned here are the ones a member would notice going wrong: a
// brand-new member is not greeted by notes about a past they never saw (the
// tour is theirs), a returning member sees every release they missed, it does
// not reopen once closed, and a security fix never gets more than a sentence.

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AboutDialog } from '@/components/AboutDialog';
import { WhatsNew, WhatsNewDialog } from '@/components/whatsnew/WhatsNewDialog';
import { SEEN_KEY, openWhatsNew, useWhatsNew } from '@/components/whatsnew/useWhatsNew';
import { RELEASE_NOTES, type ReleaseNote } from '@/lib/releaseNotes';

const LATEST = RELEASE_NOTES[0].version;

beforeEach(() => {
  localStorage.clear();
});

describe('useWhatsNew', () => {
  it('stays shut on a first visit, and records the version so the next release shows', () => {
    const { result } = renderHook(() => useWhatsNew(LATEST));
    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe(LATEST);
  });

  it('opens for a member who last saw an older release', () => {
    localStorage.setItem(SEEN_KEY, '0.0.1');
    const { result } = renderHook(() => useWhatsNew(LATEST));
    expect(result.current.open).toBe(true);
    expect(result.current.notes[0].version).toBe(LATEST);
  });

  it('stays shut once the running version has been seen', () => {
    localStorage.setItem(SEEN_KEY, LATEST);
    const { result } = renderHook(() => useWhatsNew(LATEST));
    expect(result.current.open).toBe(false);
  });

  it('marks the version seen on close, so it does not come back', () => {
    localStorage.setItem(SEEN_KEY, '0.0.1');
    const { result } = renderHook(() => useWhatsNew(LATEST));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe(LATEST);
  });

  it('does nothing on a dev build', () => {
    localStorage.setItem(SEEN_KEY, '0.0.1');
    const { result } = renderHook(() => useWhatsNew('dev'));
    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe('0.0.1');
  });

  it('opens on request even when the release has been seen', () => {
    localStorage.setItem(SEEN_KEY, LATEST);
    const { result } = renderHook(() => useWhatsNew(LATEST));
    act(() => openWhatsNew());
    expect(result.current.open).toBe(true);
    expect(result.current.notes.length).toBeGreaterThan(0);
  });
});

describe('WhatsNewDialog', () => {
  const notes: ReleaseNote[] = [
    { version: '2.1.0', date: '2026-10-01', features: ['Trade block'], fixes: ['Scores refresh'], security: 3 },
    { version: '2.0.0', date: '2026-09-01', features: ['Keeper picks'], fixes: [] },
  ];

  it('shows every release it is given, features and fixes under their own headings', () => {
    render(<WhatsNewDialog open notes={notes} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Version 2.1.0')).toBeTruthy();
    expect(screen.getByText('Version 2.0.0')).toBeTruthy();
    expect(screen.getByText('Trade block')).toBeTruthy();
    expect(screen.getByText('Scores refresh')).toBeTruthy();
    expect(screen.getByText('Keeper picks')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(2);
    expect(screen.getAllByText('Fixed')).toHaveLength(1);
  });

  it('gives security fixes one plain sentence and no count', () => {
    render(<WhatsNewDialog open notes={notes} onClose={() => {}} />);
    expect(screen.getByText('Includes several security and stability improvements.')).toBeTruthy();
    expect(screen.queryByText(/3/)).toBeNull();
  });

  it('closes from "Got it", the close control and Escape', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<WhatsNewDialog open notes={notes} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /got it/i }));
    await user.click(screen.getByRole('button', { name: /close/i }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('What’s new from About', () => {
  it('hands over from About to the notes', async () => {
    localStorage.setItem(SEEN_KEY, LATEST);
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <>
        <AboutDialog open onClose={onClose} />
        <WhatsNew />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /what.s new/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: `Version ${LATEST}` })).toBeTruthy();
  });
});
