# Plan: Add League Features — Waiver Wire, Trade Analyzer, Matchup Analysis

## Context

The League tab in `/league/dashboard` currently shows 6 placeholder cards (Standings, Roster, Matchups, Trades, Waivers, Draft) with "Coming soon" badges. These need to be replaced with three real, data-driven league tools:

1. **Waiver Wire Suggestions** — scans the user's roster for weak spots and surfaces available players to address them
2. **Trade Analyzer** — finds mutually beneficial trade proposals by comparing every team's positional surplus/deficit
3. **Matchup Analysis** — projects floor/ceiling for both teams in the current-week matchup using DB stats, Vegas lines (The Odds API), and weather (Open-Meteo)

---

## What Was Found

### Existing Infrastructure (all reusable)

| Asset | Path | Used For |
|-------|------|----------|
| `getPlayerMap()` | `src/lib/sleeper/playerCache.ts` | Player ID → name/position/team |
| Prisma `NflWeeklyStat` | `prisma/schema.prisma` | Floor/ceiling sim, player value, def strength |
| `/api/sleeper/matchups` | `src/app/api/sleeper/matchups/route.ts` | Opponent lookup pattern |
| `/api/sleeper/user` | `src/app/api/sleeper/user/route.ts` | Fetch+cache pattern |
| 5-min in-process cache | all Sleeper routes | Same TTL/Map pattern to reuse |
| Sleeper roster endpoint | `GET /v1/league/{id}/rosters` | User + all teams' player lists |
| Sleeper transactions | `GET /v1/league/{id}/transactions/{week}` | Available for context |
| Sleeper NFL state | `GET /v1/state/nfl` | Current week |
| `prisma` singleton | `src/lib/prisma.tsx` | DB queries |
| Groq/Gemini AI | `src/app/api/agent/route.ts` | Narrative generation pattern |

### Key Types in `page.tsx`
```typescript
interface SleeperUser { userId, username, displayName, avatar, leagues[] }
interface SleeperLeague { leagueId, name, season, totalRosters, status }
```

### LeagueTab Component (to be replaced)
`src/app/league/dashboard/page.tsx` — `LeagueTab` function receives `{ sleeperUser, activeLeagueId, onSelect }`.  
Currently renders a `grid` of 6 static placeholder cards. The entire placeholder grid will be replaced.

### External APIs to Add
- **Open-Meteo** (weather): `https://api.open-meteo.com/v1/forecast` — free, no API key
- **The Odds API** (Vegas): `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/` — needs `ODDS_API_KEY` env var

---

## Work Units

### Unit 1 — Waiver Wire API Route
**Files:** `src/app/api/sleeper/waiver-suggestions/route.ts` *(new)*

**Logic:**
1. `GET ?leagueId=&userId=&season=&week=`
2. Fetch all rosters → find user's roster by `owner_id`
3. Build rostered-player set (all players across all rosters)
4. Find available players = players in trending-adds not in rostered set
5. Query `NflWeeklyStat` for user's players (last 3 weeks) → compute avg pts per position
6. Query `NflWeeklyStat` for available players (last 3 weeks) → compute their avg
7. Identify user's weakest position groups (compare to league-avg starters)
8. Score available players: `(recent_avg × 0.7) + (positional_need × 0.3)`
9. Return top 8, grouped by position need

**Response:**
```typescript
{
  weakPositions: string[];  // e.g. ["RB", "WR2"]
  suggestions: Array<{
    playerId: string; name: string; position: string; team: string | null;
    recentAvg: number;   // last-3-week avg fantasy points
    reason: string;      // "Addresses RB depth — avg 14.2 pts last 3 weeks"
    trendingCount: number | null;
  }>;
}
```

**Caching:** 10-min in-process Map keyed by `${leagueId}-${userId}-${week}`.

---

### Unit 2 — Trade Analyzer API Route
**Files:** `src/app/api/sleeper/trade-suggestions/route.ts` *(new)*

**Logic:**
1. `GET ?leagueId=&userId=&season=`
2. Fetch all rosters + users (for team names)
3. Fetch season-total `fantasyPointsPpr` from `NflWeeklyStat` for every rostered player → player value map
4. For each team, rank their players by value per position → identify top-2 starter, surplus beyond that
5. User's deficit = positions where user's starters rank below league median
6. For each other team: find their surplus at user's deficit positions + their deficit at user's surplus positions
7. Build trade proposals that balance total point value within ±15% (realistic trades)
8. Score by: value balance + positional fit for both sides
9. Return top 5 proposals

**Response:**
```typescript
{
  myPositionRanks: Record<string, number>;  // position → league rank (1=best)
  proposals: Array<{
    targetTeamName: string; targetOwnerId: string;
    give: Array<{ playerId, name, position, seasonPts }>;
    receive: Array<{ playerId, name, position, seasonPts }>;
    fairnessScore: number;   // 0–100
    summary: string;         // "Trade your WR depth for their RB starter"
  }>;
}
```

**Caching:** 10-min in-process Map keyed by `${leagueId}-${userId}`.

---

### Unit 3 — Matchup Analysis API Route
**Files:** `src/app/api/sleeper/matchup-report/route.ts` *(new)*

**Logic:**
1. `GET ?leagueId=&userId=&week=&season=`
2. Fetch current-week matchup → identify user's roster ID + opponent's roster ID + opponent team name
3. Fetch both rosters' player lists
4. For each player on both rosters: query last-6-week `NflWeeklyStat` → compute mean, std dev
5. Floor = mean − 1.28 × std (10th pct); Ceiling = mean + 1.28 × std (90th pct)
6. **Defensive strength**: query `NflWeeklyStat` WHERE `opponentTeam = X AND position = Y` → avg pts allowed per position per game
7. Adjust each player's projection by a ±15% defensive matchup factor
8. **Weather** (Open-Meteo): look up stadium coordinates (static map of NFL team → lat/lon) → fetch 7-day forecast for game-day temp, wind speed, precipitation probability
9. Apply weather adjustments: wind >20 mph → −8% passing, precipitation >50% → −5% passing/receiving
10. **Vegas odds** (The Odds API): fetch NFL game totals/spreads for the week → extract game total for user's players' teams → scale team projected total against Vegas implied total
11. Sum player floors → team floor; sum player ceilings → team ceiling
12. Generate narrative summary (start/sit notes, key matchup edges)

**Response:**
```typescript
{
  week: number; season: number;
  myTeam: { name, rosterId, floor, ceiling, projected };
  opponent: { name, rosterId, floor, ceiling, projected };
  myPlayers: Array<{ playerId, name, position, team, floor, ceiling, projected, defRank, note }>;
  opponentPlayers: Array<{ ... }>;
  weather: Array<{ team, tempF, windMph, precipPct, note }> | null;
  vegasLines: Array<{ homeTeam, awayTeam, total, spread }> | null;
  narrative: string;  // "Your floor beats their ceiling in 2 of 3 simulations..."
}
```

**Caching:** 15-min in-process Map. Weather/odds cached 1 hour.
**Env var required:** `ODDS_API_KEY` (graceful fallback if missing — returns `vegasLines: null`).

---

### Unit 4 — LeagueTab UI Overhaul
**Files:** `src/app/league/dashboard/page.tsx` *(modified — only this file)*

**Changes:**
- Remove the 6-card placeholder grid entirely
- Add 3 inline panel components above `LeagueTab`:
  - `WaiverSuggestionsPanel` — card with "Find Suggestions" trigger button
  - `TradeAnalyzerPanel` — card with "Analyze Trades" trigger button
  - `MatchupReportPanel` — card with "Analyze Matchup" trigger button
- Each panel:
  - Shows a compact header (icon, title, one-line description)
  - Has a prominent action button — on click, fetches its API and shows results
  - Loading skeleton, error state, empty-data state
  - Results rendered inline within the card (expandable)
- Layout: `MatchupReportPanel` full-width on top; `WaiverSuggestionsPanel` + `TradeAnalyzerPanel` side-by-side below (responsive: stack on mobile)
- LeagueTab passes `sleeperUser.userId` and `activeLeagueId` down to each panel
- All panels require `activeLeagueId` and `sleeperUser.userId` to be set; show a "Select a league first" state otherwise

**Style conventions:** match existing dark theme (`#141415` bg, `#1e1e20` border, `#80ff49` accent).

---

## E2E Test Recipe

Each worker should run these steps to verify their unit:

```bash
# 1. Type-check
cd /Users/ProfessionalHD/Projects/commissioner-suite/nextjs
npx tsc --noEmit

# 2. Build check
npm run build

# 3. Dev server smoke test (API route workers)
npm run dev &
sleep 8
# Probe the new route with minimal params (expect 400 not 500):
curl -s "http://localhost:3000/api/sleeper/waiver-suggestions" | head -c 200
# Should return JSON { error: "..." } not a 500/HTML crash
kill %1
```

Unit 4 (UI) should additionally verify that the page renders without crashing at `http://localhost:3000/league/dashboard` (TypeScript build passing is sufficient since interactive testing requires a Sleeper login).

---

## Merge Order

PRs can be merged in any order since:
- Units 1/2/3 create new files only (zero conflicts)
- Unit 4 only touches `page.tsx` which Units 1/2/3 don't touch

Recommended: merge 1→2→3→4 in sequence, but all can be reviewed in parallel.

---

## Worker Instructions Template

```
After you finish implementing the change:
1. Code review — Invoke the Skill tool with skill: "code-review" to find correctness bugs. Fix any findings before continuing.
2. Run unit tests — npm test (or npx jest if no script).
3. Test end-to-end — Follow the e2e test recipe above.
4. Commit and push — Commit all changes with a clear message, push, and create a PR with gh pr create.
5. Report — End with a single line: PR: <url>
```
