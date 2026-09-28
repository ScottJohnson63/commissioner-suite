'use client';

// src/components/whatsnew/WhatsNewDialog.tsx
//
// The release notes a member sees once after each release (issue #71), and
// again whenever they ask for them from About.
//
// One section per release, newest first: what is new, what was fixed, and —
// if the release carried any — a single sentence saying security was worked
// on. That sentence is all a security fix ever gets; see releaseNotes.ts.
//
// The chrome is CardsDialog, as About's is, so it looks like every other
// dialog in the app.

import { CardsDialog } from '@/components/cards/CardsDialog';
import { securitySummary, type ReleaseNote } from '@/lib/releaseNotes';
import { useWhatsNew } from './useWhatsNew';

/** Mounted once in the league layout. Opens itself; nothing to pass down. */
export function WhatsNew() {
  const { open, notes, close } = useWhatsNew();
  return <WhatsNewDialog open={open} notes={notes} onClose={close} />;
}

export function WhatsNewDialog({
  open, notes, onClose,
}: {
  open: boolean;
  notes: ReleaseNote[];
  onClose: () => void;
}) {
  return (
    <CardsDialog open={open} title="What’s new" onClose={onClose} widthClassName="sm:max-w-md">
      <div className="flex flex-col gap-6">
        {notes.length === 0 ? (
          <p className="text-xs" style={{ color: '#8a8a86' }}>No release notes yet.</p>
        ) : (
          notes.map((note, i) => <ReleaseSection key={note.version} note={note} first={i === 0} />)
        )}
        <button
          onClick={onClose}
          className="self-end text-xs rounded px-3 py-1.5 transition-colors"
          style={{ background: '#80ff49', color: '#0e0e0f' }}
        >
          Got it
        </button>
      </div>
    </CardsDialog>
  );
}

function ReleaseSection({ note, first }: { note: ReleaseNote; first: boolean }) {
  return (
    <section
      className={first ? '' : 'border-t pt-5'}
      style={{ borderColor: '#26262a' }}
      aria-label={`Version ${note.version}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm" style={{ color: '#e8e6df' }}>Version {note.version}</h2>
        <span className="text-xs font-mono" style={{ color: '#555' }}>{formatDate(note.date)}</span>
      </div>

      {note.features.length > 0 && (
        <NoteList heading="New" accent="#80ff49" items={note.features} />
      )}
      {note.fixes.length > 0 && (
        <NoteList heading="Fixed" accent="#6ab0ff" items={note.fixes} />
      )}
      {(note.security ?? 0) > 0 && (
        <p className="text-xs leading-relaxed mt-4" style={{ color: '#8a8a86' }}>
          {securitySummary(note.security!)}
        </p>
      )}
    </section>
  );
}

function NoteList({ heading, accent, items }: { heading: string; accent: string; items: string[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-[10px] uppercase tracking-[0.2em]" style={{ color: accent }}>{heading}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-relaxed" style={{ color: '#c8c6bf' }}>
            <span aria-hidden="true" className="shrink-0" style={{ color: accent }}>&bull;</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `2026-09-28` → `Sep 28, 2026`, read as a calendar date rather than UTC midnight. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
