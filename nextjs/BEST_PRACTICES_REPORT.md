# Best Practices Audit Report

Audit of `nextjs/` against the seven categories in `BEST_PRACTICES.md`.
Zero TypeScript errors at time of audit.

---

## 1. Server/Client Composition — ⚠️ PARTIAL FAIL

**Finding:** One `'use client'` directive is unnecessary.

- `src/components/dashboard/shared.tsx:1` — marked `'use client'` but contains no hooks, no event handlers, and no browser-only APIs. The only interactive attribute is `onError` on an `<img>` tag (line 12), which does not require a client boundary; it would be handled by the browser natively even from a Server Component.
- All other files with `'use client'` (`TrendingTicker.tsx`, `WaiverSuggestionsPanel.tsx`, `NewsTab.tsx`, `StatisticsTab.tsx`, `DashboardClient.tsx`, etc.) are justified — they use `useState`, `useEffect`, `useCallback`, or event handlers that genuinely require the client boundary.

**Action:** Remove `'use client'` from `shared.tsx`. Verify nothing it renders depends on client state.

---

## 2. Server Actions Security — ⚠️ PASS WITH NOTES

**Finding:** No Server Actions are used (all mutations go through Route Handlers). Route Handlers are generally protected but three endpoints have no session check.

- `GET /api/leagues` — returns all leagues with no auth guard
- `GET /api/users` — returns all users with no auth guard
- `GET /api/audit` — returns the full audit log with no auth guard
- `POST /api/agent` — the AI query endpoint uses client-ID rate limiting but no session validation; any unauthenticated caller can use it

All other routes call `auth()` and return 401 when the session is absent.

**Action (low urgency):** Add `auth()` checks to the three unprotected GETs if the data is not intended to be public. Add session validation to the agent route before the rate-limit check.

---

## 3. TypeScript Configuration — ✅ PASS

`tsconfig.json` has `"strict": true`, `"moduleResolution": "bundler"`, and `"jsx": "preserve"`. The `@/*` path alias is configured. No issues.

---

## 4. Statically Typed Links — ❌ FAIL

**Finding:** `experimental.typedRoutes` is not enabled in `next.config.ts`, so all `<Link href="...">` calls and `router.push(...)` calls are untyped strings.

**Action:** Add the following to `next.config.ts`:
```ts
experimental: {
  typedRoutes: true,
},
```
After enabling, TypeScript will catch broken internal routes at build time. No code changes to existing `<Link>` components are required — valid routes will continue to compile; broken ones will surface as type errors.

---

## 5. File Colocation — ✅ PASS

Route segments, page components, and layout files follow the App Router conventions. Shared components live in `src/components/`. Library code lives in `src/lib/`. No private folder (`_folder`) misuse found. No route-segment files placed outside their `app/` subtree.

---

## 6. Absolute Imports — ✅ PASS

All imports use the `@/*` alias (e.g., `@/lib/api`, `@/types/trending`). No relative `../../` imports found in the codebase.

---

## 7. Production & Performance — ❌ FAIL

### 7a. `<img>` instead of `next/image` (5 instances)

Five components use a bare `<img>` tag suppressed with `// eslint-disable-next-line @next/next/no-img-element`. This opts out of WebP conversion, lazy loading, and layout shift prevention:

| File | Line |
|------|------|
| `src/components/dashboard/shared.tsx` | 12 |
| `src/components/dashboard/TrendingTicker.tsx` | 92 |
| `src/components/dashboard/WaiverSuggestionsPanel.tsx` | 69 |
| `src/components/dashboard/NewsTab.tsx` | 145 |
| `src/components/dashboard/StatisticsTab.tsx` | 197 |

**Action:** Replace each with `<Image>` from `next/image`. Supply explicit `width` and `height` props (or `fill` with a positioned container) to prevent CLS. Remove the eslint-disable comments once migrated.

### 7b. No environment variable startup validation

**Finding:** API keys (`ODDS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `DATABASE_URL`) are accessed inline at call time (`process.env.X`). A missing variable silently produces `undefined`, causing a runtime error deep inside a request rather than a startup error with a clear message.

**Action:** Add a `src/lib/env.ts` module that validates required variables at import time:
```ts
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const env = {
  DATABASE_URL:   requireEnv('DATABASE_URL'),
  GROQ_API_KEY:   requireEnv('GROQ_API_KEY'),
  GEMINI_API_KEY: requireEnv('GEMINI_API_KEY'),
  ODDS_API_KEY:   requireEnv('ODDS_API_KEY'),
};
```
Import `env` from this module in place of `process.env.X` access. This causes the server to fail fast at startup rather than at request time.

### 7c. No Suspense boundaries on data-fetching components

**Finding:** `DashboardClient.tsx` and related panels fetch data client-side with no `<Suspense>` wrappers. Users see no loading state while data loads.

**Action (medium priority):** Wrap async data-fetching sections in `<Suspense fallback={<Skeleton />}>`.

### Passing items

- **Fonts:** `next/font/google` is used in `layout.tsx` — zero layout shift on font load. ✅
- **No bare `<script>` tags** — no third-party scripts bypassing `next/script`. ✅
- **Server-side fetch caching:** All server-side fetches use `next: { revalidate: N }` — ISR is wired correctly. ✅

---

## Summary

| Category | Status | Priority |
|----------|--------|----------|
| Server/Client Composition | ⚠️ Partial fail — 1 unnecessary `'use client'` | Low |
| Server Actions Security | ⚠️ Pass with notes — 3 unauthed GETs, agent unauthed | Medium |
| TypeScript Config | ✅ Pass | — |
| Statically Typed Links | ❌ Fail — `typedRoutes` not enabled | Low (one-line fix) |
| File Colocation | ✅ Pass | — |
| Absolute Imports | ✅ Pass | — |
| Production & Performance | ❌ Fail — 5 `<img>` tags; no env validation; no Suspense | Medium–High |
