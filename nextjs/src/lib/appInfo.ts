// src/lib/appInfo.ts
//
// The handful of facts the About dialog shows. They live here rather than in
// the dialog so the version has a single source — package.json, forwarded to
// the client by `env` in next.config.ts — and so the repo links can be reused
// by anything else that needs to point a member at GitHub.

/**
 * The running app version, taken from package.json at build time. The fallback
 * only shows up outside a Next build (unit tests, a stray script), where there
 * is no version to report.
 *
 * The scheme is plain semver now that the suite has shipped 1.0.0. It was
 * `1.0.0-alpha.<commits>` while the suite was pre-1.0, so that a version in a
 * bug report pointed at a place in the log; a released version names a release
 * instead, and the log is reached through the tag.
 *
 * Which way a PR moves it is CLAUDE.md's rule, not this file's — it reads the
 * size off the issue's label — so it is stated there once rather than restated
 * here where the two would drift apart.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

export const GITHUB_REPO_URL = 'https://github.com/ScottJohnson63/commissioner-suite';

/** Where a member reports a bug or asks for a feature. */
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

/**
 * The user's guide. It is not written yet, so this points at the docs folder on
 * GitHub — somewhere real, and the place the guide will land. Swap it for
 * `${GITHUB_REPO_URL}/blob/main/docs/USER_GUIDE.md` once that file exists.
 */
export const USER_GUIDE_URL = `${GITHUB_REPO_URL}/tree/main/docs`;

/**
 * Where the player stats come from. nflverse publishes them under CC BY 4.0,
 * which asks for visible credit, a link to the licence, and a note when the
 * data has been changed — so both links are constants rather than markup, and
 * the About dialog says outright that the fantasy figures are ours, not theirs.
 */
export const NFLVERSE_DATA_URL = 'https://github.com/nflverse/nflverse-data';

/** The licence nflverse publishes that data under. */
export const CC_BY_4_URL = 'https://creativecommons.org/licenses/by/4.0/';
