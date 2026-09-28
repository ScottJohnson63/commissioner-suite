// src/lib/releaseNotes.ts
//
// What the What's New dialog tells a member about each release (issue #71).
//
// Written by hand, in the same PR that bumps the version. Commit messages are
// written for whoever reads the code next, not for a league member, so this is
// the one place the changes are put in the member's terms. A test pins the
// newest entry to the version in package.json, so a bump without an entry here
// fails CI rather than shipping a release the dialog cannot describe.
//
// Security fixes are a count and nothing else. This file is bundled into the
// client, so anything written here about a weakness is readable by anyone who
// opens the page source — the dialog turns the count into one plain sentence
// and the details stay in the PR that fixed them.

export interface ReleaseNote {
  /** Semver, exactly as package.json has it. */
  version: string;
  /** ISO date the release was cut, for the heading. */
  date: string;
  /** New things a member can do, one short sentence each. */
  features: string[];
  /** Things that were wrong and are not any more. */
  fixes: string[];
  /** How many security fixes went in. Never described, only counted. */
  security?: number;
}

/** Newest first. Add the new release at the top. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.2.0',
    date: '2026-09-28',
    features: [
      'This What’s New window, which opens once after each release. You can bring it back any time from About.',
      'Opening a pack now plays a reveal, and “Open another” hands you a fresh sealed pack.',
      'Player cards credit the photographer and licence behind each portrait.',
      'The Draft Deck tour explains the bonus packs Sleeper awards.',
      'About credits nflverse for the player statistics.',
    ],
    fixes: [
      'A new Draft Deck week publishes at its deadline instead of hours later.',
      'You can no longer open a pack when you have none left.',
      'Closing the pack window after opening a pack keeps the cards in your deck.',
      'Photo rewards are counted correctly.',
      'The first-place bonus no longer awards an extra pack mid-week.',
      'Pages load faster, especially Draft Deck.',
    ],
    security: 5,
  },
];

/** What the dialog says in place of any security detail. */
export function securitySummary(count: number): string {
  return count === 1
    ? 'Includes a security improvement.'
    : 'Includes several security and stability improvements.';
}

/** `1.2.10` → [1, 2, 10]; anything else (`dev`, a prerelease) → null. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when a is older than b, positive when newer, 0 when equal or unparseable. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** True when a version string is one the dialog can reason about. */
export function isReleaseVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

/** Whether an entry has anything to show. An internal-only patch does not. */
export function hasContent(note: ReleaseNote): boolean {
  return note.features.length > 0 || note.fixes.length > 0 || (note.security ?? 0) > 0;
}

/**
 * The entries a member has not seen: newer than `seen`, no newer than
 * `current`, and with something to say. Newest first, as they are stored.
 */
export function unseenNotes(
  seen: string,
  current: string,
  notes: ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote[] {
  return notes.filter(
    (n) => compareVersions(n.version, seen) > 0
      && compareVersions(n.version, current) <= 0
      && hasContent(n),
  );
}

/** Every entry up to the running version, for opening the dialog on request. */
export function notesUpTo(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  if (!isReleaseVersion(current)) return notes.filter(hasContent);
  return notes.filter((n) => compareVersions(n.version, current) <= 0 && hasContent(n));
}
