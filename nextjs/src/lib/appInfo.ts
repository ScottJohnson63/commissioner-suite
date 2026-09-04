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
