'use client';

// src/components/AboutDialog.tsx
//
// What the About button at the foot of the sidebar opens: the version the
// member is actually running, and the two places they might need to go next —
// the issue tracker and the user's guide.
//
// It borrows CardsDialog for its chrome. That component lives under cards/
// because the card game was the first thing to need a dialog, but it is only
// an overlay, a title bar and a scrollable body — reusing it is what keeps
// this dialog looking like the rest of the app rather than a second style.

import { CardsDialog } from '@/components/cards/CardsDialog';
import { APP_VERSION, GITHUB_ISSUES_URL, USER_GUIDE_URL } from '@/lib/appInfo';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <CardsDialog open={open} title="About" onClose={onClose} widthClassName="sm:max-w-sm">
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-sm" style={{ color: '#e8e6df' }}>Commissioner Suite</div>
          <div className="text-xs mt-1 font-mono" style={{ color: '#555' }}>
            Version {APP_VERSION}
          </div>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: '#8a8a86' }}>
          A front office for your fantasy league — dashboard, sync, assistant and
          the Draft Deck card game.
        </p>

        <div className="flex flex-col gap-1.5">
          <AboutLink
            href={USER_GUIDE_URL}
            label="User&rsquo;s guide"
            hint="How the suite fits together"
            icon={<BookIcon />}
          />
          <AboutLink
            href={GITHUB_ISSUES_URL}
            label="Report an issue"
            hint="Bugs and feature requests on GitHub"
            icon={<BugIcon />}
          />
        </div>
      </div>
    </CardsDialog>
  );
}

// ─── One row of the link list ────────────────────────────────────────────────

function AboutLink({
  href, label, hint, icon,
}: {
  href: string;
  label: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      // Both links leave the app for GitHub, so they open beside it rather than
      // dropping the member out of whatever they were doing.
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded px-2 py-2 -mx-2 transition-colors"
      style={{ color: '#e8e6df' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1c')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0" style={{ color: '#80ff49' }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm leading-none">{label}</span>
        <span className="block text-xs mt-1" style={{ color: '#555' }}>{hint}</span>
      </span>
    </a>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 2.5h4a2 2 0 012 2v8a1.6 1.6 0 00-1.6-1.6H2zM13 2.5H9a2 2 0 00-2 2v8a1.6 1.6 0 011.6-1.6H13z" strokeLinejoin="round" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4.5" y="4.5" width="6" height="8" rx="3" />
      <path d="M5.5 3.5a2 2 0 014 0M1.5 6.5h3M10.5 6.5h3M1.5 11h3M10.5 11h3M7.5 6v6" strokeLinecap="round" />
    </svg>
  );
}
