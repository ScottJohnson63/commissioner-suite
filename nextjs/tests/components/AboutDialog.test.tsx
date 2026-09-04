// tests/components/AboutDialog.test.tsx
//
// The About dialog is mostly copy, and copy does not need a test. What does:
// the version has to come from the app's own constant rather than a number
// typed into the markup, the two links have to point at GitHub and open away
// from the app, and a member who opens it has to be able to get back out.

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AboutDialog } from '@/components/AboutDialog';
import { APP_VERSION, GITHUB_ISSUES_URL, USER_GUIDE_URL } from '@/lib/appInfo';

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
