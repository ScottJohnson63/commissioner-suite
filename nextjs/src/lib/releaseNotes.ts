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
  // The first entry, and the first thing most members read about the suite
  // since launch — so it rounds up the notable changes of the last few weeks
  // rather than only what 1.2.0 itself added. Later entries cover one release.
  {
    version: '1.2.0',
    date: '2026-09-28',
    features: [
      'This What\u2019s New window, which opens once after each release. You can bring it back any time from About.',
      'Opening a pack is a proper reveal: pull the strip to tear it, and \u201cOpen another\u201d hands you a fresh sealed pack.',
      'Draft Deck cards have a Card Details page, and the corner shows the player\u2019s season rank.',
      'The dashboard gives Matchup, Waivers and Trades a tab each.',
      'The AI Assistant answers from your own roster, and its chat uses the whole screen on a phone.',
      'Statistics keeps regular-season and playoff leaders apart, with a toggle to include the playoffs.',
      'Player cards credit the photographer and licence behind each portrait.',
      'The Draft Deck tour explains the bonus packs Sleeper results earn you.',
      'About links the user\u2019s guide and issue tracker, and credits nflverse for the player statistics.',
    ],
    fixes: [
      'A new Draft Deck week publishes at its deadline instead of hours later.',
      'Sleeper bonus packs are awarded for the week that finished, not a lead that could still slip away.',
      'You can no longer open a pack when you have none left.',
      'Closing the pack window after opening a pack keeps the cards in your deck.',
      'The packs offered for uploading photos match what you\u2019re actually given.',
      'The AI Assistant no longer fails with \u201cAgent failed to respond.\u201d',
      'Pages load faster, Draft Deck especially.',
    ],
    security: 10,
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
