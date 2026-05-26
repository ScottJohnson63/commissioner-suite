# Code Cleanup Plan 2

Based on a full re-audit after Cleanup Plan 1 (Tiers 1–3) was applied.
Zero TypeScript errors at time of audit.

---

## High Priority

### 1. Resolve the dual `TrendingPlayer` definition

**Problem:** Two incompatible versions of the same type exist in the codebase.

- `src/lib/agentContext.ts:12–16` — minimal shape: `{ player_id, count, type }` only
- `src/types/trending.ts:1–8` — enriched shape: adds `name`, `position`, `team`

The agent route imports from `agentContext`, all dashboard components and the trending route import from `@/types/trending`. The enriched fields are just optional additions, so the minimal version is a strict subset.

**Action:** Delete the `TrendingPlayer` interface in `agentContext.ts` and import it from `@/types/trending` instead. Update the `TrendingPlayer` export in `agentContext.ts` to re-export from `@/types/trending` if anything imports it from there.

---

### 2. Fix `AuditActionType` redefinition in the log page

**Problem:** `AuditActionType` is exported from `src/lib/audit.ts` (the canonical definition) but redefined as a local type in `src/app/league/log/page.tsx:6`.

**Action:** Remove the inline definition from `log/page.tsx` and replace it with:
```ts
import type { AuditActionType } from '@/lib/audit';
```

---

## Medium Priority

### 3. Deduplicate the fantasy position constants

**Problem:** Two identical arrays with different names exist in separate routes.

- `src/app/api/sleeper/trade-suggestions/route.ts:64` — `POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const`
- `src/app/api/sleeper/waiver-suggestions/route.ts:37` — `SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const`

**Action:** Create `src/lib/fantasy.ts`:
```ts
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const;
export type SkillPos = (typeof SKILL_POSITIONS)[number];
```
Import from there in both routes and remove the local declarations.

---

### 4. Migrate hand-rolled caches in `news` and `trending` to `RouteCache`

**Problem:** Two routes predate `src/lib/cache.ts` and still use bespoke `Map<K, { data, ts }>` patterns with manual TTL checks.

- `src/app/api/news/route.ts:49–53` — `interface CacheEntry { articles: NewsArticle[]; ts: number }` + `Map<NewsSource, CacheEntry>`
- `src/app/api/trending/route.ts:29–33` — `interface CacheEntry { data: SleeperTrendingPlayer[]; fetchedAt: number }` + two separate maps (data + last-fetch timestamp)

The trending route additionally has a rate-limit guard (`SLEEPER_MIN_INTERVAL_MS`) that `RouteCache` does not replicate, so the news route is the simpler migration target.

**Action (news route):** Replace the hand-rolled cache with `new RouteCache<NewsArticle[]>()` and use `.get(key, TTL)` / `.set(key, data)`. Remove the `CacheEntry` interface.

**Action (trending route):** The rate-limit guard (serve stale if last real fetch was < 10 min ago, even when TTL has expired) is intentional behaviour. Migrate the data storage to `RouteCache` but keep the `trendingLastFetch` map for the guard, or extract the guard logic into a helper.

---

### 5. Extract agent route types to `src/types/agent.ts`

**Problem:** `src/app/api/agent/route.ts` contains large inline type declarations (lines 29–88):
- `interface PlayerStats` (33 fields)
- `type ModelUsed`
- `type QueryIntent` (11 variants)
- `interface QueryPlan`

These are not route-specific — they describe the data contract between the DB query layer and the prompt builder. Keeping them inline in a 742-line file makes them hard to find and impossible to reuse.

**Action:** Create `src/types/agent.ts` and move all four declarations there. Import them back into `route.ts`. This is also a prerequisite for item 6 below.

---

### 6. Split the agent route into focused modules

**Problem:** At 742 lines, `src/app/api/agent/route.ts` is the last large file in the codebase. It contains five distinct concerns:
1. Client initialisation (Groq + Gemini)
2. Turso stat queries (`executeQueryPlan` and its helpers, ~400 LOC)
3. Intent classification (`classifyIntent`, ~50 LOC)
4. System prompt construction (~100 LOC)
5. The actual POST handler + streaming (~100 LOC)

**Action:**
- `src/lib/agent/queries.ts` — `executeQueryPlan`, `resolvePlayerId`, `STAT_SELECT`, and the `PlayerStats`/`QueryPlan` types (if not moved to `src/types/agent.ts`)
- `src/lib/agent/classify.ts` — `classifyIntent` and its prompt
- `src/lib/agent/prompt.ts` — the system prompt builder
- `src/app/api/agent/route.ts` — POST handler only; imports from the three above

Estimated result: route file shrinks to ~120 lines.

---

### 7. Move `SleeperLeague` response type out of the user route

**Problem:** `src/app/api/sleeper/user/route.ts:14` defines `interface SleeperLeague` — a shaped response type describing what the endpoint returns. Response types for API endpoints belong in `src/types/`.

**Action:** Add `SleeperLeague` to `src/types/schedule.ts` (or a new `src/types/sleeper.ts`) and import it in the user route.

---

## Low Priority / Intentional Exceptions

### Legitimate `NextResponse.json()` call-sites not converted to `err()`

These two call-sites intentionally bypass the `err()` helper and should not be changed:

- `src/app/api/agent/route.ts:665–668` — 429 rate-limit response requires custom `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers that `err()` does not support.
- `src/app/api/leagues/sync/route.ts:56–61` — partial-sync error must return `{ error, results }` so the caller knows which leagues succeeded before the failure.

### Inline types acceptable where they are

- `src/app/api/sleeper/matchup-report/route.ts:37–39` — `MockPlayer` / `MockRoster` are demo scaffolding tightly coupled to `MOCK_MATCHUP`. No other file needs them.
- `src/app/api/assoc/standings/route.ts:10–23` — `MatchFrom` / `BracketMatch` describe Sleeper's playoff bracket wire format; they are implementation details of `rankFromBrackets` and have no broader use.
- `src/app/api/trending/route.ts:13–16` — `SleeperTrendingPlayer` is a raw Sleeper API shape intentionally kept separate from the enriched `TrendingPlayer` exported to clients.

---

## What to skip

- **`src/lib/sleeper/sync.test.ts` keeps `import 'dotenv/config'`** — this is a manual integration script (outside Jest's testMatch), not a unit test. It reads `SLEEPER_LEAGUES` and `DATABASE_URL` from `.env` directly.
- **`dotenv` stays in `devDependencies`** — needed by `sync.test.ts` above.
- **Sleeper bracket-parsing types in `assoc/standings`** — route-specific, no extraction needed.

---

## Summary

| Item | Files touched | Effort |
|------|--------------|--------|
| Resolve dual `TrendingPlayer` | 2 | Low |
| Fix `AuditActionType` in log page | 1 | Low |
| Centralise position constants | 3 | Low |
| Migrate news cache to `RouteCache` | 1 | Low |
| Migrate trending cache to `RouteCache` | 1 | Medium |
| Extract agent types to `src/types/agent.ts` | 2 | Low |
| Split agent route into modules | 4 new + 1 edit | High |
| Move `SleeperLeague` type | 2 | Low |
