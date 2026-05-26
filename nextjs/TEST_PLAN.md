# Test Plan — Commissioner Suite

## 1. Overview

This plan covers three layers of testing:

| Layer | Tool | Scope |
|---|---|---|
| Unit & Integration | Jest + ts-jest | Pure logic, lib modules, API routes |
| Component | Jest + React Testing Library (jsdom) | React components and hooks |
| E2E / UI | Playwright | Full user flows in a real browser |

**Coverage target:** 100% lines/branches on pure logic; ≥90% on mocked-dependency modules; UI behavior coverage via E2E flows.

---

## 2. Current State

### What exists and is broken
- `src/lib/scheduler/engine.test.ts` — **not a Jest test**. It is a console-only script with no `describe`/`it`/`expect`. It must be replaced.
- `src/lib/sleeper/sync.test.ts` — **not a Jest test**. Same problem. It is a manual integration runner. It must be replaced.
- `tests/app/api/nfl/route.test.ts` and `tests/app/api/trending/route.test.ts` — exist but their quality is unknown.
- `tests/setup.ts` — only sets `PYTHON_API_URL`. Needs to grow.

### What is configured correctly
- `jest.config.js` already uses `ts-jest`, `moduleNameMapper` for `@/` alias, and `testMatch: ['**/tests/**/*.test.ts']`.
- A `tests/setup.ts` hook is registered via `setupFiles`.

---

## 3. Packages to Install

```bash
# Component testing
npm install --save-dev jest-environment-jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom

# E2E
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

No package changes are needed for unit/API tests — Jest, ts-jest, and the jest-environment-node preset are already installed.

---

## 4. Config Changes

### 4a. jest.config.js — multi-project setup

Replace the current single-config with a `projects` array so API-route tests run in `node` and component tests run in `jsdom`. This avoids per-file `@jest-environment` comments.

```js
/** @type {import('jest').Config} */
const baseMapper = { '^@/(.*)$': '<rootDir>/src/$1' };

const config = {
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/app/api/**/*.ts',
    'src/hooks/**/*.ts',
    'src/components/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/lib/prisma.tsx',        // thin re-export, not worth mocking
    '!src/lib/scheduler/types.ts', // type-only, no runtime branches
    '!src/types/**',
  ],
  coverageThreshold: {
    global: { lines: 85, branches: 80, functions: 85, statements: 85 },
  },
  projects: [
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      moduleNameMapper: baseMapper,
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts', '<rootDir>/tests/app/**/*.test.ts'],
      setupFiles: ['<rootDir>/tests/setup.ts'],
    },
    {
      displayName: 'jsdom',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      moduleNameMapper: baseMapper,
      testMatch: ['<rootDir>/tests/components/**/*.test.tsx', '<rootDir>/tests/hooks/**/*.test.ts'],
      setupFiles: ['<rootDir>/tests/setup.ts'],
      setupFilesAfterFramework: ['<rootDir>/tests/setupDom.ts'],
    },
  ],
};

module.exports = config;
```

### 4b. tests/setup.ts — add more env vars

```ts
process.env.PYTHON_API_URL  = 'http://localhost:8000';
process.env.NFL_SEASON      = '2025';
process.env.ADMIN_USERNAME  = 'admin';
process.env.SCHEDULE_MAX_ATTEMPTS = '100';
```

### 4c. tests/setupDom.ts (new file)

```ts
import '@testing-library/jest-dom';
```

### 4d. playwright.config.ts (new file)

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## 5. Mocking Strategy

### Prisma
All API routes import `prisma` from `@/lib/prisma`. Mock the entire module in each test file:

```ts
jest.mock('@/lib/prisma', () => ({
  prisma: {
    league:      { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    team:        { findMany: jest.fn(), updateMany: jest.fn() },
    auditLog:    { create: jest.fn() },
    user:        { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    sleeperCache:{ findUnique: jest.fn(), upsert: jest.fn() },
    nflWeeklyStat:{ findMany: jest.fn(), findFirst: jest.fn() },
  },
}));
```

Create a reusable helper at `tests/mocks/prisma.ts` so each test file can import `mockPrisma` and call `mockPrisma.league.findMany.mockResolvedValue(...)`.

### fetch
Use `jest.spyOn(global, 'fetch')` or a global mock in `setup.ts`. For detailed control, use `jest.fn()` per test.

### NextRequest / NextResponse
`NextResponse` is available in the `node` test environment from `next/server`. Construct `NextRequest` with:

```ts
import { NextRequest } from 'next/server';
const req = new NextRequest('http://localhost/api/...',
  { method: 'POST', body: JSON.stringify({ ... }), headers: { 'content-type': 'application/json' } }
);
```

### next-auth (components only)
```ts
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({ data: null, status: 'unauthenticated' })),
}));
```

---

## 6. Unit Tests — Pure Logic (100% coverage target)

These files have **no external dependencies**. They are the easiest to cover completely.

### 6a. `src/lib/math.ts` → `tests/unit/lib/math.test.ts`

| Test case | Description |
|---|---|
| `stdDev([])` | Returns 0 for empty array |
| `stdDev([5])` | Returns 0 for single element |
| `stdDev([2, 4, 4, 4, 5, 5, 7, 9])` | Returns known population stddev ≈ 2 |
| `stdDev([10, 10, 10])` | Returns 0 for identical values |
| `stdDev([-1, 1])` | Handles negative numbers |

### 6b. `src/lib/cache.ts` → `tests/unit/lib/cache.test.ts`

Use `jest.useFakeTimers()` to control `Date.now()`.

| Test case | Description |
|---|---|
| `get` on empty cache | Returns null |
| `set` then `get` within TTL | Returns stored data |
| `set` then `get` after TTL expires | Returns null (stale) |
| `set` two different keys | Each returns correct value |
| `clear` then `get` | Returns null |
| Generic type param | Works with objects, arrays, primitives |

### 6c. `src/lib/rateLimit.ts` → `tests/unit/lib/rateLimit.test.ts`

Use `jest.useFakeTimers()` and reset module state between tests (the `dailyBucket` and `hourlyBuckets` are module-level globals — use `jest.resetModules()` or reset via exported functions).

| Test case | Description |
|---|---|
| `getDailyCount` on new day | Returns 0 |
| `incrementDaily` then `getDailyCount` | Returns 1 |
| `getDailyCount` rolls over at midnight | Returns 0 after day change |
| `checkHourlyLimit` — first call | Returns `allowed: true`, `remaining: HOURLY_LIMIT - 1` |
| `checkHourlyLimit` — at HOURLY_LIMIT | Returns `allowed: false` |
| `checkHourlyLimit` — resets after 1 hour | Returns `allowed: true` again |
| `checkHourlyLimit` — different clients are independent | Client A limits do not affect Client B |
| `getClientId` — x-client-id header | Returns trimmed header value |
| `getClientId` — x-forwarded-for header | Returns first IP from list |
| `getClientId` — no headers | Returns `'unknown'` |

### 6d. `src/lib/api.ts` → `tests/unit/lib/api.test.ts`

| Test case | Description |
|---|---|
| `ok(data)` | Returns 200 response with JSON body |
| `ok(data, 201)` | Returns 201 response |
| `err('message')` | Returns 500 response with `{ error: 'message' }` |
| `err('message', 404)` | Returns 404 response |
| `err('message', 400)` | Returns 400 response |

### 6e. `src/lib/stadiums.ts` → `tests/unit/lib/stadiums.test.ts`

| Test case | Description |
|---|---|
| All 32 teams present | `STADIUM_COORDS` has entries for all expected team codes |
| Dome stadiums are marked | ARI, ATL, DAL, DET, HOU, IND, LAC, LAR, LV, MIN, NO all have `dome: true` |
| Outdoor stadiums are not domes | BAL, BUF, GB etc. have `dome: false` |
| Coordinates are plausible | All `lat` values between 25–50, `lon` values between -130 and -60 |
| No duplicate keys | Object has exactly 32 entries (all unique) |

### 6f. `src/lib/scheduler/engine.ts` → `tests/unit/lib/scheduler/engine.test.ts`

This **replaces** the existing non-Jest script at `src/lib/scheduler/engine.test.ts`.

| Test case | Description |
|---|---|
| `generateSchedule` — happy path | Generates 13 weeks with 5 matchups each |
| Each team plays exactly 13 games | No team over- or under-scheduled |
| Every team plays every week | All 10 teams appear in every week's matchups |
| Division matchups played twice | Each within-division pair appears exactly 2 times |
| Cross-division matchups played once | Each cross-division pair appears exactly 1 time |
| No consecutive repeat matchups | Adjacent weeks share no identical pair |
| Wrong team count throws `ScheduleError` | Passing 9 or 11 teams throws |
| Uneven division throws `ScheduleError` | Passing teams all in division 0 throws |
| `maxAttempts: 1` still succeeds (usually) | Low attempt count — verify error is `ScheduleError` when it fails |
| Deterministic structure despite randomness | Generated schedule always satisfies `validateSchedule` |
| `ScheduleError` is instanceof `Error` | Error class extends properly |

---

## 7. Unit Tests — Lib with External Dependencies

These modules require mocking of Prisma and/or `fetch`.

### 7a. `src/lib/sleeper/client.ts` → `tests/unit/lib/sleeper/client.test.ts`

Mock `global.fetch`. Constant `SLEEPER_BASE` is tested by inspection.

| Test case | Description |
|---|---|
| `sleeperGet` — success | Returns parsed JSON from Sleeper |
| `sleeperGet` — HTTP 4xx | Throws error with status + path |
| `sleeperGet` — custom revalidate | Passes `next: { revalidate }` to fetch |
| `SLEEPER_BASE` value | Is `'https://api.sleeper.app/v1'` |

### 7b. `src/lib/sleeper/sync.ts` → `tests/unit/lib/sleeper/sync.test.ts`

This **replaces** the existing non-Jest script at `src/lib/sleeper/sync.test.ts`.
Mock `sleeperGet`.

| Test case | Description |
|---|---|
| `fetchLeagueData` — happy path | Returns `{ leagueId, name, season, teams }` with 10 teams |
| Team name fallback chain | `team_name > display_name > "Team N"` |
| Division IDs are 0-indexed | roster `division: 1` → `divisionId: 0`, division `2` → `1` |
| Non-2-division league throws | `settings.divisions !== 2` throws `Error` |
| Users without team_name use display_name | Metadata absent uses display_name |

### 7c. `src/lib/sleeper/playerCache.ts` → `tests/unit/lib/sleeper/playerCache.test.ts`

Mock `global.fetch` and `@/lib/prisma`. Use `jest.useFakeTimers()` for TTL tests.

| Test case | Description |
|---|---|
| Returns in-memory cache when fresh | Does not call DB or fetch |
| Falls through to DB when memory stale | Calls `prisma.sleeperCache.findUnique` |
| DB hit younger than 24h | Returns DB data, populates memory |
| DB hit older than 24h | Falls through to fetch |
| Fetch success | Returns parsed map, persists to DB via upsert |
| `parsePlayerJson` — full_name present | Uses full_name |
| `parsePlayerJson` — first_name + last_name | Concatenates them |
| `parsePlayerJson` — no name | Skips entry |
| `parsePlayerJson` — position fallback | Uses `fantasy_positions[0]` if `position` absent |
| `parsePlayerJson` — null team | Sets team to null |
| Fetch failure (non-ok response) | Throws error |
| DB write failure is non-fatal | Returns map even if upsert throws |

### 7d. `src/lib/audit.ts` → `tests/unit/lib/audit.test.ts`

Mock `@/lib/prisma`.

| Test case | Description |
|---|---|
| `writeAuditLog` — success | Calls `prisma.auditLog.create` with correct action/leagueId/detail |
| `writeAuditLog` — null leagueId | Passes `leagueId: undefined` to Prisma |
| `writeAuditLog` — detail is JSON serialized | `detail` stored as string |
| `writeAuditLog` — Prisma throws | Does NOT rethrow (audit failures are non-fatal) |
| `writeAuditLog` — console.error on failure | Logs the error |

### 7e. `src/lib/weather.ts` → `tests/unit/lib/weather.test.ts`

Mock `global.fetch` and `RouteCache`. Use `jest.useFakeTimers()`.

| Test case | Description |
|---|---|
| Dome stadium | Returns null without fetching |
| Unknown team | Returns null without fetching |
| Cache hit within TTL | Returns cached data, no fetch |
| Fetch failure (non-ok) | Returns null |
| Fetch throws | Returns null |
| Wind > 20 mph | Note includes "High wind" |
| Precip > 60% | Note includes "Rain likely" |
| Temp < 20°F | Note includes "Extreme cold" |
| Good conditions | Note is `'Good conditions'` |
| Multiple conditions | Notes are joined with `'; '` |
| Result is cached after fetch | Second call uses cache |

### 7f. `src/lib/odds.ts` → `tests/unit/lib/odds.test.ts`

Mock `global.fetch` and `RouteCache`.

| Test case | Description |
|---|---|
| `getLiveOdds` — cache hit | Returns cached data |
| `getLiveOdds` — sports fetch fails | Returns null |
| `getLiveOdds` — no active sports | Returns null |
| `getLiveOdds` — priority sport selected | Picks first active sport in SPORT_PRIORITY |
| `getLiveOdds` — falls back to any active sport | When none in priority list are active |
| `getLiveOdds` — odds fetch fails | Returns null |
| `getLiveOdds` — populates VegasLine fields | total, spread, sport extracted correctly |
| `getLiveOdds` — empty games array | Returns null |
| `getNflOdds` — no API key | Returns null |
| `getNflOdds` — cache hit | Returns cached data |
| `getNflOdds` — fetch success | Returns lines for all games |
| `getNflOdds` — fetch failure | Returns null |
| `getNflOdds` — throws | Returns null |
| `SPORT_PRIORITY` order | Verify the constant contains expected sports in order |

### 7g. `src/lib/agentContext.ts` → `tests/unit/lib/agentContext.test.ts`

Mock `global.fetch` and `@/lib/prisma`. Complex module — focus on key branches.

| Test case | Description |
|---|---|
| `fetchTrending` — both endpoints succeed | Returns adds and drops arrays with `type` set |
| `fetchTrending` — endpoints return null | Returns empty arrays |
| `fetchSleeperPlayerMap` — memory fresh | Returns without DB/network call |
| `fetchSleeperPlayerMap` — DB hit | Returns DB data when memory stale |
| `fetchSleeperPlayerMap` — DB stale, fetch fresh | Returns fetched data |
| `fetchSleeperPlayerMap` — DB read error | Falls through to fetch silently |
| `sleeperFetch` rate-limit guard | Returns stale data if called within MIN_INTERVAL |
| `fetchLeagueContext` — happy path | Returns full context object |
| `fetchLeagueContext` — no DB league | Uses league ID as fallback name |
| `fetchLeagueContext` — rosters/users mapped | ownerName prefers team_name > display_name |
| `fetchLeagueContext` — standings sorted by wins then pointsFor | Verify sort order |
| `fetchLeagueContext` — week capped at 18 for schedule | `weeksToFetch.filter(w => w <= 18)` |
| `fetchLeagueContext` — throws | Returns null |

---

## 8. API Route Tests

Each route test file lives in `tests/app/api/<path>/route.test.ts`. All routes require:
- `jest.mock('@/lib/prisma', ...)`
- `jest.mock('@/lib/audit', ...)` where used
- A `NextRequest` factory helper

### 8a. `src/app/api/users/route.ts` — GET

| Test case | Description |
|---|---|
| DB returns users | 200 with user array (admin excluded) |
| DB throws | 500 with error message |

### 8b. `src/app/api/users/[id]/route.ts` — GET / PATCH / DELETE

| Test case | Description |
|---|---|
| GET — user found | 200 with user data |
| GET — not found | 404 |
| PATCH — valid body | 200, calls `prisma.user.update` |
| PATCH — DB throws | 500 |
| DELETE — success | 200 |
| DELETE — not found | 404 |

### 8c. `src/app/api/leagues/route.ts` — GET

| Test case | Description |
|---|---|
| DB returns leagues | 200 with league array |
| DB throws | 500 |

### 8d. `src/app/api/leagues/sync/route.ts` — POST

| Test case | Description |
|---|---|
| Valid league ID | Fetches from Sleeper, upserts in DB, writes audit log, returns 200 |
| Missing leagueId in body | 400 |
| Sleeper fetch fails | 502 or 500 |
| Non-2-division league | 400 with specific error |

### 8e. `src/app/api/leagues/[id]/schedule/route.ts` — GET / POST / DELETE

| Test case | Description |
|---|---|
| GET — schedule exists | 200 with schedule data |
| GET — no schedule | 404 |
| POST — generates and saves | 200, calls `generateSchedule`, writes audit log |
| POST — wrong team count | 400 |
| DELETE — success | 200 |
| DELETE — not found | 404 |

### 8f. `src/app/api/leagues/[id]/schedule/export/route.ts` — GET

| Test case | Description |
|---|---|
| Returns CSV export | 200 with `text/csv` content-type |
| No schedule found | 404 |

### 8g. `src/app/api/assoc/standings/route.ts` — GET

| Test case | Description |
|---|---|
| Missing leagueId param | 400 |
| League not found | 404 |
| No previous_league_id from Sleeper | 404 |
| `rankFromBrackets` — championship match ranked first | Rank 1 = championship winner |
| `rankFromBrackets` — consolation match ranked 3/4 | Losers bracket assigns later ranks |
| `rankFromBrackets` — final round championship vs consolation sort | Championship match processed before consolation |
| Full happy path | Returns standings sorted by rank |

### 8h. `src/app/api/assoc/divisions/route.ts` — POST

| Test case | Description |
|---|---|
| Valid body | 200, calls `updateMany`, writes audit log |
| Missing leagueId | 400 |
| Empty standings array | 400 |
| League not found | 404 |

### 8i. `src/app/api/assoc/draft-order/route.ts` — GET / POST

Review file first, then add test cases.

### 8j. `src/app/api/assoc/lottery-log/route.ts` — GET / POST

Review file first, then add test cases.

### 8k. `src/app/api/audit/route.ts` — GET

| Test case | Description |
|---|---|
| Returns audit entries | 200 with array |
| DB throws | 500 |

### 8l. `src/app/api/matchups/[id]/route.ts` — GET

Review file first, then add test cases.

### 8m. `src/app/api/news/route.ts` — GET

| Test case | Description |
|---|---|
| Returns news items | 200 |
| External fetch fails | Returns empty/error |

### 8n. `src/app/api/nfl/[...path]/route.ts` — GET (proxy)

| Test case | Description |
|---|---|
| Valid path | Proxies to Python API, returns data |
| Python API unreachable | 502 |
| PYTHON_API_URL not set | 500 |

### 8o. `src/app/api/trending/route.ts` — GET

| Test case | Description |
|---|---|
| Sleeper returns trending | 200 with trending data |
| Sleeper fetch fails | Error response |

### 8p. `src/app/api/sleeper/user/route.ts` — GET

| Test case | Description |
|---|---|
| userId param | Fetches by user ID |
| username param | Fetches by username |
| Neither param | 400 |
| User not found | 404 or empty |

### 8q. `src/app/api/sleeper/matchups/route.ts` — GET

Review file, then add test cases.

### 8r. `src/app/api/sleeper/matchup-report/route.ts` — POST

This route calls out to weather/odds/AI. Mock all three.

| Test case | Description |
|---|---|
| DEMO_MODE with demo matchup | Returns report with demo data |
| Real matchup — success | 200 with report |
| Missing required fields | 400 |
| AI provider fails | 500 or falls back |

### 8s. `src/app/api/sleeper/waiver-suggestions/route.ts` — POST

| Test case | Description |
|---|---|
| DEMO_MODE | Returns mock waiver data |
| Real request — success | 200 with suggestions |
| Missing fields | 400 |

### 8t. `src/app/api/sleeper/trade-suggestions/route.ts` — POST

| Test case | Description |
|---|---|
| DEMO_MODE | Returns mock trade data |
| Real request — success | 200 with suggestions |
| Missing fields | 400 |

### 8u. `src/app/api/errors/route.ts` — POST

| Test case | Description |
|---|---|
| Logs error and returns 204 | Error saved / acknowledged |

### 8v. `src/app/api/agent/route.ts` — POST

The most complex route. Mock all AI clients, Prisma, and rate-limiter functions.

| Test case | Description |
|---|---|
| Missing messages array | 400 |
| Rate limit exceeded | 429 with `X-RateLimit-*` headers |
| No API keys configured | 500 |
| Groq success | Streams response with correct headers |
| Groq rate-limit error → Gemini fallback | 200, `X-Fallback-Reason: groq_rate_limit` |
| Gemini also fails | 502 |
| `X-Model-Used` header set correctly | `groq` or `gemini` |
| `X-Query-Intent` header reflects plan | Set from classified intent |
| `X-League-Context: true` when leagueCtx present | Set when league ID provided + league-aware intent |
| `X-Daily-Prompts-Used` header | Increments per request |

---

## 9. Auth Tests

### 9a. `src/auth.ts` → `tests/unit/auth/validateSleeperMembership.test.ts`

Mock `global.fetch` and `@/lib/prisma`.

| Test case | Description |
|---|---|
| User not found on Sleeper | Returns null |
| User found, leagues fetch fails | Returns null |
| User in no tracked leagues | Returns null |
| User in a tracked league | Returns `{ userId, username }` |
| Throws during fetch | Returns null |

Note: The NextAuth config callbacks (`jwt`, `session`) are deeply integrated with NextAuth internals and are most reliably covered by E2E tests rather than unit tests. The `authorize` credential function can be unit-tested by mocking Prisma and bcrypt.

### 9b. Credentials `authorize` function — `tests/unit/auth/credentials.test.ts`

Mock `@/lib/prisma`, `bcryptjs`, and `validateSleeperMembership`.

| Test case | Description |
|---|---|
| Missing username/password | Returns null |
| User not found | Returns null |
| User found, wrong password | Returns null |
| Valid credentials, not in Sleeper league | Returns null |
| Valid credentials, in Sleeper league | Returns user object |
| Sleeper user ID updated if changed | Calls `prisma.user.update` |

---

## 10. Component Tests

Use `jest-environment-jsdom` + `@testing-library/react`. Mock `next-auth/react` and `next/navigation` in all component tests.

### 10a. `src/components/dashboard/shared.tsx` → `tests/components/dashboard/shared.test.tsx`

| Test case | Description |
|---|---|
| `PlayerAvatar` renders img with correct src | `sleepercdn.com` URL includes playerId |
| `PlayerAvatar` img onError hides image | Error event hides the `<img>` |
| `PanelActionBtn` renders label | Default (non-loading) shows `label` |
| `PanelActionBtn` renders loadingLabel | When `loading: true` shows `loadingLabel` |
| `PanelActionBtn` disabled when `loading` | Button has disabled attribute |
| `PanelActionBtn` disabled when `disabled` prop | Button has disabled attribute |
| `PanelActionBtn` calls onClick | Click fires handler |
| `PanelSkeleton` renders correct row count | `rows` prop controls skeleton count |
| `PanelSkeleton` renders custom height | Height style applied |
| `NoLeague` renders message | "Select a league first" text visible |

### 10b. `src/hooks/useSleeperData.ts` → `tests/hooks/useSleeperData.test.ts`

Mock `next-auth/react` and `global.fetch`.

| Test case | Description |
|---|---|
| No session | Does not fetch, `sleeperUser` is null |
| Session with sleeperUserId | Fetches `/api/sleeper/user?userId=...` |
| Session with username (no userId) | Fetches `/api/sleeper/user?username=...` |
| Fetch succeeds | `sleeperUser` populated, first league selected as active |
| Saved league in localStorage | That league is selected if it matches |
| Saved league not in data | Falls back to first league |
| Fetch fails | `sleeperUser` remains null |
| `setActiveLeagueId` | Updates state and localStorage |

### 10c. Other components

For each component in `src/components/` and `src/components/dashboard/`, write smoke tests:
- Renders without crashing
- Key props appear in the DOM
- Interaction handlers fire (if applicable)

Specific components: `DashboardHeader`, `LeagueSelector`, `LeagueSidebar`, `LeagueSwitcher`, `MatchupCell`, `ScheduleGrid`, `StatCards`, `TeamLog`, `DivisionsTab`, `LeagueTab`, `LotteryTab`, `MatchupReportPanel`, `NewsTab`, `SchedulesTab`, `StatisticsTab`, `TradeAnalyzerPanel`, `TrendingTicker`, `WaiverSuggestionsPanel`.

---

## 11. E2E / UI Tests (Playwright)

These tests run against the real Next.js dev server. They validate full user flows and catch integration issues that unit tests cannot.

### Test File Layout

```
tests/e2e/
  auth.spec.ts
  login.spec.ts
  dashboard.spec.ts
  assoc.spec.ts
  ai-agent.spec.ts
```

### 11a. Login / Auth — `tests/e2e/auth.spec.ts`

| Flow | Description |
|---|---|
| Guest visits `/` | Login page is shown (not dashboard) |
| Invalid credentials | Error message displayed |
| Commissioner login (credentials) | Redirects to `/league/dashboard` |
| OAuth button visible | Discord and Google buttons rendered |
| Session persists on refresh | User stays logged in |

### 11b. League Dashboard — `tests/e2e/dashboard.spec.ts`

Requires a seeded test DB or demo mode.

| Flow | Description |
|---|---|
| Dashboard loads | Tabs visible (Schedule, Divisions, Lottery, etc.) |
| League switcher changes active league | Dropdown selection updates content |
| Schedule tab — generate schedule | Button click triggers generation, schedule appears |
| Schedule tab — export CSV | Download triggered |
| Statistics tab renders | No JS errors, data visible |
| Sidebar collapses on mobile viewport | Sidebar hidden at `width: 375px` |

### 11c. Players Association — `tests/e2e/assoc.spec.ts`

| Flow | Description |
|---|---|
| PA member cannot generate schedule | Button is absent or disabled |
| PA member sees association tabs | Read-only view renders |
| Commissioner sees manage button | Manage panel accessible |
| Division selection saved | Selecting divisions updates UI |
| Lottery picker runs | Lottery button animates and selects a winner |

### 11d. AI Agent — `tests/e2e/ai-agent.spec.ts`

| Flow | Description |
|---|---|
| Page loads at `/league/ai` | Chat interface visible |
| Sending a message | Loading spinner shown, then response streamed |
| Rate limit message shown | After `HOURLY_LIMIT` requests, friendly error displayed |
| Demo mode query | If DEMO_MODE enabled, gets a response without real AI key |

---

## 12. Test File Map

| Source File | Test File | Environment | Coverage Target |
|---|---|---|---|
| `src/lib/math.ts` | `tests/unit/lib/math.test.ts` | node | 100% |
| `src/lib/cache.ts` | `tests/unit/lib/cache.test.ts` | node | 100% |
| `src/lib/rateLimit.ts` | `tests/unit/lib/rateLimit.test.ts` | node | 100% |
| `src/lib/api.ts` | `tests/unit/lib/api.test.ts` | node | 100% |
| `src/lib/stadiums.ts` | `tests/unit/lib/stadiums.test.ts` | node | 100% |
| `src/lib/scheduler/engine.ts` | `tests/unit/lib/scheduler/engine.test.ts` | node | 100% |
| `src/lib/sleeper/client.ts` | `tests/unit/lib/sleeper/client.test.ts` | node | 100% |
| `src/lib/sleeper/sync.ts` | `tests/unit/lib/sleeper/sync.test.ts` | node | ~95% |
| `src/lib/sleeper/playerCache.ts` | `tests/unit/lib/sleeper/playerCache.test.ts` | node | ~90% |
| `src/lib/audit.ts` | `tests/unit/lib/audit.test.ts` | node | 100% |
| `src/lib/weather.ts` | `tests/unit/lib/weather.test.ts` | node | ~95% |
| `src/lib/odds.ts` | `tests/unit/lib/odds.test.ts` | node | ~95% |
| `src/lib/agentContext.ts` | `tests/unit/lib/agentContext.test.ts` | node | ~85% |
| `src/auth.ts` (`validateSleeperMembership`) | `tests/unit/auth/validateSleeperMembership.test.ts` | node | ~90% |
| `src/auth.ts` (credentials `authorize`) | `tests/unit/auth/credentials.test.ts` | node | ~90% |
| `src/app/api/users/route.ts` | `tests/app/api/users/route.test.ts` | node | 100% |
| `src/app/api/users/[id]/route.ts` | `tests/app/api/users/[id]/route.test.ts` | node | ~95% |
| `src/app/api/leagues/route.ts` | `tests/app/api/leagues/route.test.ts` | node | 100% |
| `src/app/api/leagues/sync/route.ts` | `tests/app/api/leagues/sync/route.test.ts` | node | ~90% |
| `src/app/api/leagues/[id]/schedule/route.ts` | `tests/app/api/leagues/[id]/schedule/route.test.ts` | node | ~90% |
| `src/app/api/leagues/[id]/schedule/export/route.ts` | `tests/app/api/leagues/[id]/schedule/export/route.test.ts` | node | ~90% |
| `src/app/api/assoc/standings/route.ts` | `tests/app/api/assoc/standings/route.test.ts` | node | ~90% |
| `src/app/api/assoc/divisions/route.ts` | `tests/app/api/assoc/divisions/route.test.ts` | node | ~95% |
| `src/app/api/assoc/draft-order/route.ts` | `tests/app/api/assoc/draft-order/route.test.ts` | node | ~90% |
| `src/app/api/assoc/lottery-log/route.ts` | `tests/app/api/assoc/lottery-log/route.test.ts` | node | ~90% |
| `src/app/api/audit/route.ts` | `tests/app/api/audit/route.test.ts` | node | 100% |
| `src/app/api/matchups/[id]/route.ts` | `tests/app/api/matchups/[id]/route.test.ts` | node | ~90% |
| `src/app/api/news/route.ts` | `tests/app/api/news/route.test.ts` | node | ~90% |
| `src/app/api/nfl/[...path]/route.ts` | `tests/app/api/nfl/route.test.ts` | node | ~90% |
| `src/app/api/trending/route.ts` | `tests/app/api/trending/route.test.ts` | node | ~90% |
| `src/app/api/sleeper/user/route.ts` | `tests/app/api/sleeper/user/route.test.ts` | node | ~90% |
| `src/app/api/sleeper/matchups/route.ts` | `tests/app/api/sleeper/matchups/route.test.ts` | node | ~90% |
| `src/app/api/sleeper/matchup-report/route.ts` | `tests/app/api/sleeper/matchup-report/route.test.ts` | node | ~85% |
| `src/app/api/sleeper/waiver-suggestions/route.ts` | `tests/app/api/sleeper/waiver-suggestions/route.test.ts` | node | ~90% |
| `src/app/api/sleeper/trade-suggestions/route.ts` | `tests/app/api/sleeper/trade-suggestions/route.test.ts` | node | ~90% |
| `src/app/api/errors/route.ts` | `tests/app/api/errors/route.test.ts` | node | 100% |
| `src/app/api/auth/connect-sleeper/route.ts` | `tests/app/api/auth/connect-sleeper/route.test.ts` | node | ~85% |
| `src/app/api/agent/route.ts` | `tests/app/api/agent/route.test.ts` | node | ~80% |
| `src/components/dashboard/shared.tsx` | `tests/components/dashboard/shared.test.tsx` | jsdom | 100% |
| `src/hooks/useSleeperData.ts` | `tests/hooks/useSleeperData.test.ts` | jsdom | ~90% |
| All other components | `tests/components/**/*.test.tsx` | jsdom | ≥80% |
| Key user flows | `tests/e2e/*.spec.ts` | Playwright | N/A |

---

## 13. Implementation Order

Work through phases in this order to build confidence early on the simplest code:

**Phase 1 — Infrastructure (do this first, nothing else works without it)**
1. Install packages
2. Update `jest.config.js` to multi-project setup
3. Expand `tests/setup.ts`
4. Create `tests/setupDom.ts`
5. Create `tests/mocks/prisma.ts` shared mock helper
6. Create `playwright.config.ts`

**Phase 2 — Pure logic units (high ROI, no mocking needed)**
1. `math.test.ts`
2. `cache.test.ts`
3. `api.test.ts`
4. `stadiums.test.ts`
5. `rateLimit.test.ts`
6. `scheduler/engine.test.ts` (replace the existing script)

**Phase 3 — Lib with external deps**
1. `sleeper/client.test.ts`
2. `sleeper/sync.test.ts` (replace the existing script)
3. `audit.test.ts`
4. `weather.test.ts`
5. `odds.test.ts`
6. `sleeper/playerCache.test.ts`
7. `agentContext.test.ts`

**Phase 4 — Auth unit tests**
1. `auth/validateSleeperMembership.test.ts`
2. `auth/credentials.test.ts`

**Phase 5 — API route tests (most numerous)**
- Start with simple CRUD routes (users, leagues, audit)
- Then associations (divisions, standings)
- Then complex routes (agent, matchup-report, schedule generation)

**Phase 6 — Component tests**
1. `shared.tsx` (pure, no hooks)
2. `useSleeperData.test.ts`
3. Remaining components

**Phase 7 — E2E**
1. Login flow
2. Dashboard tab navigation
3. AI agent interaction
4. Commissioner-only flows

---

## 14. Notes for Each Test Author

Per the PLAN.md requirement: **leave detailed comments in each unit test** so the owner can review intent without reading the source.

Template pattern for every test block:

```ts
// WHY: Verifies that the function returns null for arrays with fewer than 2 elements,
//      which avoids dividing by zero and matches the documented contract.
it('returns 0 for a single-element array', () => {
  expect(stdDev([42])).toBe(0);
});
```

Comments should explain:
- What invariant or contract is being checked
- Why this edge case matters (what bug it would catch)
- Any non-obvious setup in the `arrange` phase

---

## 15. What Makes 100% Coverage Achievable

These files have **no branches that depend on external I/O**, so every line and branch can be exercised with simple input variation:

- `math.ts` — 2 branches (length < 2)
- `cache.ts` — 3 branches (missing, expired, valid)
- `api.ts` — 2 branches (status === 200 or not)
- `stadiums.ts` — data-only, 0 branches
- `scheduler/types.ts` — type-only, excluded from coverage

For modules with Prisma/fetch, any `catch` block that only logs (`console.error`) must have the mock throw an error to cover that branch. Without this, the unhappy path lines go unexecuted and coverage drops.

The `src/app/api/agent/route.ts` will be hardest to reach 100% because it has deeply nested branches in `executeQueryPlan`. Target ~80% and document which branches are excluded and why (e.g., `case 'unreachable'` throws statement after a loop guard).
