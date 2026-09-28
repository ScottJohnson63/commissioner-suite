// tests/unit/lib/releaseNotes.test.ts
//
// The release notes behind the What's New dialog (issue #71).
//
// Two things are pinned beyond the version arithmetic. The newest entry has to
// be the version package.json ships, so a bump that forgets its notes fails
// here rather than reaching members with a dialog about the release before.
// And security fixes stay a number: the notes are bundled into the client, so
// a sentence describing a fixed weakness would be readable by anyone.

import { describe, it, expect } from '@jest/globals';
import pkg from '../../../package.json';
import {
  RELEASE_NOTES,
  compareVersions,
  hasContent,
  notesUpTo,
  securitySummary,
  unseenNotes,
  type ReleaseNote,
} from '@/lib/releaseNotes';

const note = (version: string, extra: Partial<ReleaseNote> = {}): ReleaseNote => ({
  version, date: '2026-01-01', features: ['something'], fixes: [], ...extra,
});

describe('RELEASE_NOTES', () => {
  it('has an entry for the version in package.json, at the top', () => {
    expect(RELEASE_NOTES[0]?.version).toBe(pkg.version);
  });

  it('runs newest first with no version listed twice', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version)).toBeGreaterThan(0);
    }
  });

  it('uses plain semver and ISO dates', () => {
    for (const n of RELEASE_NOTES) {
      expect(n.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('counts security fixes rather than describing them', () => {
    for (const n of RELEASE_NOTES) {
      for (const line of [...n.features, ...n.fixes]) {
        expect(line).not.toMatch(/\b(security|vulnerab|exploit|CVE|XSS|injection|auth bypass)/i);
      }
    }
  });
});

describe('securitySummary', () => {
  it('says nothing specific, whatever the count', () => {
    expect(securitySummary(1)).toBe('Includes a security improvement.');
    expect(securitySummary(4)).toBe('Includes several security and stability improvements.');
  });
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.1.10', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });

  it('treats anything that is not a release as incomparable', () => {
    expect(compareVersions('dev', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', 'garbage')).toBe(0);
  });
});

describe('unseenNotes', () => {
  const notes = [note('1.3.0'), note('1.2.1', { features: [] }), note('1.2.0'), note('1.1.0')];

  it('returns every release since the one last seen, up to the running one', () => {
    expect(unseenNotes('1.1.0', '1.3.0', notes).map((n) => n.version)).toEqual(['1.3.0', '1.2.0']);
  });

  it('leaves out releases newer than the one running', () => {
    expect(unseenNotes('1.1.0', '1.2.0', notes).map((n) => n.version)).toEqual(['1.2.0']);
  });

  it('skips a release with nothing to say', () => {
    expect(unseenNotes('1.2.0', '1.2.1', notes)).toEqual([]);
  });

  it('counts a security-only release as something to say', () => {
    expect(hasContent(note('1.0.0', { features: [], security: 1 }))).toBe(true);
    expect(hasContent(note('1.0.0', { features: [] }))).toBe(false);
  });
});

describe('notesUpTo', () => {
  it('lists every release so far with content, for opening on request', () => {
    const notes = [note('1.3.0'), note('1.2.1', { features: [] }), note('1.2.0')];
    expect(notesUpTo('1.2.1', notes).map((n) => n.version)).toEqual(['1.2.0']);
    expect(notesUpTo('dev', notes).map((n) => n.version)).toEqual(['1.3.0', '1.2.0']);
  });
});
