// tests/components/AboutDialog.test.tsx
//
// The About dialog is mostly copy, and copy does not need a test. What does:
// the version has to come from the app's own constant rather than a number
// typed into the markup, the two links have to point at GitHub and open away
// from the app, and a member who opens it has to be able to get back out.
//
// The nflverse credit is the exception to "copy does not need a test". It is
// there to satisfy CC BY 4.0, so the three things that licence asks for — the
// source linked, the licence linked, and the changes stated — are each pinned
// here rather than left to whoever next tidies the markup.

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AboutDialog } from '@/components/AboutDialog';
import {
  APP_VERSION,
  CC_BY_4_URL,
  GITHUB_ISSUES_URL,
  NFLVERSE_DATA_URL,
  USER_GUIDE_URL,
} from '@/lib/appInfo';

describe('AboutDialog', () => {
  it('stays out of the way until it is opened', () => {
    render(<AboutDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports the running version', () => {
    render(<AboutDialog open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(`Version ${APP_VERSION}`)).toBeTruthy();
  });

  it('links out to the issue tracker and the guide, in a new tab', () => {
    render(<AboutDialog open onClose={() => {}} />);

    const issues = screen.getByRole('link', { name: /report an issue/i });
    expect(issues.getAttribute('href')).toBe(GITHUB_ISSUES_URL);
    expect(issues.getAttribute('target')).toBe('_blank');
    // Opening a tab without this hands the new page a handle on ours.
    expect(issues.getAttribute('rel')).toContain('noopener');

    const guide = screen.getByRole('link', { name: /guide/i });
    expect(guide.getAttribute('href')).toBe(USER_GUIDE_URL);
    expect(guide.getAttribute('target')).toBe('_blank');
  });

  it('credits nflverse and links the licence it is published under', () => {
    render(<AboutDialog open onClose={() => {}} />);

    const source = screen.getByRole('link', { name: /nflverse/i });
    expect(source.getAttribute('href')).toBe(NFLVERSE_DATA_URL);
    expect(source.getAttribute('target')).toBe('_blank');
    expect(source.getAttribute('rel')).toContain('noopener');

    const licence = screen.getByRole('link', { name: /cc by 4\.0/i });
    expect(licence.getAttribute('href')).toBe(CC_BY_4_URL);
    expect(licence.getAttribute('target')).toBe('_blank');
    expect(licence.getAttribute('rel')).toContain('noopener');
  });

  it('says the fantasy numbers are derived rather than nflverse data', () => {
    render(<AboutDialog open onClose={() => {}} />);

    // CC BY 4.0 asks for a note when the licensed material was changed. The
    // raw stats are nflverse's; the fantasy figures on top of them are ours.
    expect(
      screen.getByText(/derived by Commissioner Suite/i),
    ).toBeTruthy();
  });

  it('closes on the close control and on Escape', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<AboutDialog open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
