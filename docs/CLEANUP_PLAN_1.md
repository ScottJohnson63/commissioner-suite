# Code Cleanup Plan 1

Based on a full codebase audit. Goal: remove duplicate logic, centralize shared code, enforce one function = one task.

---

## Tier 1 — High Impact, Low Risk

### 1. Create a shared Sleeper HTTP client

**Problem:** Every Sleeper API route redefines `const BASE = 'https://api.sleeper.app/v1'` and `async function sleeperGet<T>()`. It appears in 9 files:
- `src/app/api/sleeper/matchup-report/route.ts`
- `src/app/api/sleeper/trade-suggestions/route.ts`
- `src/app/api/sleeper/waiver-suggestions/route.ts`
- `src/app/api/sleeper/matchups/route.ts`
- `src/app/api/sleeper/user/route.ts`
- `src/app/api/assoc/standings/route.ts`
- `src/app/api/trending/route.ts`
- `src/app/api/agent/route.ts`
- `src/lib/sleeper/sync.ts`

**Action:** Create `src/lib/sleeper/client.ts`:
```ts
export const SLEEPER_BASE = 'https://api.sleeper.app/v1';
export async function sleeperGet<T>(path: string, revalidate = 300): Promise<T>
```
Replace all 9 inline definitions with an import from this file. The existing `playerCache.ts` already lives here — it should also use this client internally.

---

### 2. Consolidate Sleeper type definitions

**Problem:** `SleeperRoster`, `SleeperUser`, `SleeperMatchupRaw`, `SleeperNflState`, `SleeperLeague` are defined inline in multiple route files. `SleeperUser` and `SleeperLeague` are also exported from `src/hooks/useSleeperData.ts`.

**Action:** Create `src/lib/sleeper/types.ts` with all canonical Sleeper shapes. Update the hook and all route files to import from there. The hook should re-export only the types it adds on top (or just import from types.ts directly).

---

### 3. Create a shared `RouteCache<T>` utility

**Problem:** At least 6 routes create their own `Map<string, {data, ts}>` + TTL check pattern — `matchupCache`, `weatherCache`, `oddsCache`, etc. The logic is identical (check age vs TTL, return stale-or-fetch) but copied every time.

**Action:** Create `src/lib/cache.ts`:
```ts
export class RouteCache<T> {
  private store = new Map<string, { data: T; ts: number }>();
  get(key: string, ttlMs: number): T | null  // returns null if stale/missing
  set(key: string, data: T): void
  clear(key: string): void
}
```
Replace all inline cache Maps in routes with instances of this class. TTL constants can remain per-route or move to a `cache.constants.ts`.

---

### 4. Delete the superseded migration script

**Problem:** `scripts/migrate-turso.ts` creates the initial User/Account/Session schema. `prisma/migrate-turso.ts` is a later migration that drops `sleeperUsername` and enforces `NOT NULL`. The scripts version is a one-time artifact that was applied months ago and should not be re-run.

**Action:**
1. Verify `npm run migrate:turso` in `package.json` points to the `prisma/` version.
2. Delete `scripts/migrate-turso.ts` (it's dangerous to leave an "initial schema creator" runnable alongside a state-sensitive migration).

---

## Tier 2 — Medium Impact, Moderate Effort

### 5. Extract dashboard types to `src/types/`

**Problem:** `src/app/league/dashboard/page.tsx` (2,621 lines) contains 20+ `interface`/`type` declarations inline (lines 15–149 and again around line 926). Several of these (`PlayerProjection`, `TeamProjection`, `WeatherInfo`, `VegasLine`, `MatchupReportResponse`) are also defined in `src/app/api/sleeper/matchup-report/route.ts`.

**Action:** Create `src/types/` with:
- `projections.ts` — `PlayerProjection`, `TeamProjection`, `WeatherInfo`, `VegasLine`, `MatchupReportResponse`
- `suggestions.ts` — `WaiverSuggestion`, `WaiverSuggestionsResponse`, `TradePlayer`, `TradeProposal`, `TradeSuggestionsResponse`
- `standings.ts` — `StandingEntry`, `StandingsResponse`, `AssocTeam`, `AssocSchedule`
- `schedule.ts` — `MatchupWithTeams`, `DbLeague`
- `lottery.ts` — `LotteryResult`, `DraftPick`

Both the dashboard and the API routes import from these shared types. This alone reduces the dashboard by ~150 LOC and eliminates the duplicate definitions in the route files.

---

### 6. Extract the 6 dashboard tabs into components

**Problem:** Each tab in `src/app/league/dashboard/page.tsx` (`league`, `statistics`, `news`, `schedules`, `divisions`, `lottery`) is 300–500 LOC of JSX rendered inline in a single component. The result is a 2,621-line file where finding anything requires scrolling through thousands of lines.

**Action:** Create components in `src/components/dashboard/`:
- `LeagueTab.tsx`
- `StatisticsTab.tsx`
- `NewsTab.tsx`
- `SchedulesTab.tsx`
- `DivisionsTab.tsx`
- `LotteryTab.tsx`

The dashboard page becomes a thin shell (~200 LOC) that fetches data and hands props to each tab. Each tab component is independently readable and testable.

---

### 7. Extract agent route concerns

**Problem:** `src/app/api/agent/route.ts` (1,057 lines) contains: inline rate limiting (~40 LOC), Groq client setup, Gemini client setup, Sleeper data fetching, season/roster context assembly, and prompt construction. These are 5 distinct concerns in one file.

**Action:**
- Extract rate limiting to `src/lib/rateLimit.ts` (a function that takes a user id + window + limit and returns allow/deny)
- Extract season context assembly to `src/lib/agentContext.ts` (fetches and shapes the data passed to the AI)
- The route itself becomes: authenticate → check rate limit → build context → call AI → return response

---

### 8. Extract matchup-report helpers

**Problem:** `src/app/api/sleeper/matchup-report/route.ts` contains hardcoded stadium coordinates for all 32 NFL teams (lines 102–135), `stdDev()` math, `getWeather()`, and `getLiveOdds()` — all inline.

**Action:**
- `src/lib/stadiums.ts` — the stadium data as an exported `Record<string, Stadium>`
- `src/lib/weather.ts` — `getWeather(stadiumCoords): Promise<WeatherInfo>`
- `src/lib/odds.ts` — `getLiveOdds(): Promise<VegasLine[]>`
- `src/lib/math.ts` — `stdDev(values: number[]): number` (pure function, trivially testable)

---

## Tier 3 — Nice to Have

### 9. Standardize API response formatting

**Problem:** Each route constructs `NextResponse.json(...)` and error objects independently. There's no standard shape for `{ success, data, error }`.

**Action:** Create `src/lib/api.ts`:
```ts
export function ok<T>(data: T, status = 200): NextResponse
export function err(message: string, status = 500): NextResponse
```
Use throughout all 22 routes. This is a refactor, not a correctness fix — do it last.

---

### 10. Remove unused dependencies

- **`concurrently`** — not imported anywhere, not in any npm script. Remove from `devDependencies`.
- **`dotenv`** — imported in `engine.ts` and test setup. Next.js auto-loads `.env`; this import is redundant for runtime. Only keep it in tests if Jest doesn't load `.env.local` automatically.

---

## What to skip

- **Python scripts** — clean and well-separated already; no changes needed.
- **Config files** — standard boilerplate; no changes needed.
- **Component sizes** — all 8 components are under 250 LOC and focused; no extraction needed here.
- **Prisma migrations** — 5 migrations is normal history; do not consolidate.

---

## Summary

| Item | Files touched | LOC saved (est.) |
|------|--------------|-----------------|
| Shared Sleeper client | 9 | ~180 |
| Shared Sleeper types | 8 | ~120 |
| Shared RouteCache | 6 | ~90 |
| Delete duplicate migration | 1 deleted | 70 |
| Dashboard types extracted | 1 → 5 | dashboard −150 |
| Dashboard tabs extracted | 1 → 7 | dashboard −1,800 |
| Agent route split | 1 → 3 | agent −350 |
| Matchup-report helpers | 1 → 5 | matchup −250 |
| **Total** | **~30 files** | **~3,000 LOC reorganized, ~400 deleted** |
