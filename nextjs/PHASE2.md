# Phase 2 Implementation Summary
## Commissioner Suite — AI Agent League Context

---

## What Phase 2 Does

Connects the AI agent to the user's Sleeper account so league-aware questions
return personalized answers. Without a connected league, the agent answers from
general NFL data and prompts the user to connect. With a league connected, the
agent has access to live roster data, real standings, and upcoming schedules.

---

## Files Changed

| File | Destination | Status |
|------|-------------|--------|
| `route.ts` | `nextjs/src/app/api/agent/route.ts` | Updated |
| `page.tsx` | `nextjs/src/app/league/ai/page.tsx` | Updated |
| `sleeper_user_route.ts` | `nextjs/src/app/api/sleeper/user/route.ts` | New file |

No schema changes. No new dependencies. No new GitHub Actions needed.
The `sync_sleeper_scores.py` script written earlier is now obsolete — see below.

---

## Architecture

### User flow
1. User clicks **Connect Sleeper** button (top-right of AI page)
2. Enters their Sleeper username → hits `/api/sleeper/user?username=X`
3. Their leagues populate as a dropdown — user selects one
4. Username + league ID persist in `localStorage`
5. Every subsequent prompt includes `sleeperLeagueId` in the request body
6. Agent fetches league context and injects it into the system prompt

### Data flow per prompt (league-aware intents only)
```
Client → POST /api/agent { messages, sleeperLeagueId }
  → Pass 1: classifyIntent() → QueryPlan
  → If intent needs league context AND sleeperLeagueId provided:
      fetchLeagueContext(sleeperLeagueId, playerMap)
        → GET /league/{id}/rosters  (cached 5 min)
        → GET /league/{id}/users    (cached 5 min)
        → GET /state/nfl            (cached 10 min)
        → GET /schedule/nfl/...     (cached 10 min)
  → Pass 2: streamGroq/streamGemini with injected league block
```

---

## New API Route

### `GET /api/sleeper/user?username=X`

Proxies two Sleeper calls server-side:
1. `/user/{username}` — resolves username to user object
2. `/user/{userId}/leagues/nfl/{season}` — fetches their leagues

Returns:
```json
{
  "userId": "...",
  "username": "...",
  "displayName": "...",
  "leagues": [
    {
      "leagueId": "...",
      "name": "Baby got Dak",
      "season": 2025,
      "totalRosters": 10,
      "status": "in_season",
      "playoffWeekStart": 15
    }
  ]
}
```

Cached 5 minutes via `next: { revalidate: 300 }`.

---

## Standings — Key Design Decision

**What was built first (wrong):** `fetchStandingsFromTurso` derived W/L from
the commissioner suite's `Matchup` table. This was placeholder zeros because
the commissioner schedule doesn't store fantasy scores.

**What was attempted next (also wrong):** A sync script to pull scores from
Sleeper's `/league/{id}/matchups/{week}` and write them to `Matchup.homePoints`
/ `Matchup.awayPoints`. This failed because the commissioner's generated
schedule doesn't match Sleeper's actual matchups — they're two different things.
The commissioner schedule is a proposed round-robin; Sleeper's matchups are
what managers actually play.

**What was built instead (correct):** `fetchLeagueRostersAndStandings` makes
a single `/league/{id}/rosters` call. Sleeper stores running W/L/PF totals
directly on each roster's `settings` object:

```
roster.settings.wins
roster.settings.losses
roster.settings.ties
roster.settings.fpts          // integer part of points for
roster.settings.fpts_decimal  // decimal part (e.g. 60 = .60)
```

One request. No accumulation. No schema changes. Always accurate.

---

## League Context Injected into System Prompt

When `sleeperLeagueId` is present and the intent is league-aware, this block
is appended to the system prompt:

```
--- LEAGUE CONTEXT: Baby got Dak (Week 9) ---
STANDINGS:
  1. Team Alpha (7-1, 1204.40 PF)
  2. Team Beta  (6-2, 1156.80 PF)
  ...

ROSTERS:
  Team Alpha: Patrick Mahomes, Jahmyr Gibbs, ...
  Team Beta:  Josh Allen, Saquon Barkley, ...

UPCOMING NFL MATCHUPS (next 2-3 weeks):
  Wk9:  KC vs BUF
  Wk10: PHI vs DAL
  ...
```

---

## League-Aware Intents

These intents trigger league context fetching when `sleeperLeagueId` is present:

| Intent | Example question | League data used |
|--------|-----------------|------------------|
| `roster_scan` | "Who in our league has weak RBs?" | Full roster list |
| `playoff_schedule` | "Who has easiest playoff schedule?" | Standings + upcoming matchups |
| `trending` | "Who should I pick up?" | Rosters (to check availability) |
| `player_comparison` | "Should I start Lamar or Mahomes?" | Roster context |

---

## Missing League Handling

When a league-aware intent fires without a `sleeperLeagueId`, the model is
explicitly instructed:

> "NOTE: The user asked a league-specific question but has not connected their
> Sleeper account. Remind them to enter their Sleeper username using the Connect
> Sleeper button in the top-right corner of this page to unlock league-aware
> features. Still answer as helpfully as possible with the general data available."

---

## UI Changes (page.tsx)

**Connect Sleeper button** (header, top-right):
- Green border + text when connected, showing the active league name
- Grey when disconnected, showing "Connect Sleeper"
- Clicking opens a dropdown panel

**Dropdown panel:**
- Username text input with Enter key support
- "Go" button (green) — calls `/api/sleeper/user`
- Error message on invalid username
- League list renders after successful lookup
- Selected league highlighted in green
- "Disconnect" link clears localStorage and resets state

**Persistence (localStorage):**
- `sleeper_username` — restored on mount, pre-fills the input
- `sleeper_league_id` — sent with every agent request
- `sleeper_league_name` — displayed in the button

---

## Sleeper Rate Limit Impact

Phase 2 adds at most **3 Sleeper calls per agent request** for league-aware
intents (rosters + users + state). All three are covered by the existing
10-minute `SLEEPER_MIN_INTERVAL_MS` guard in `sleeperFetch`. At your scale
of 1-5 concurrent users, Sleeper sees at most 3 upstream calls per 10 minutes
per league — well within the 1,000 RPM limit.

---

## What's NOT in Phase 2

| Item | Reason |
|------|--------|
| Real-time matchup scores during the week | Sleeper only updates scores live via websocket, not REST |
| Head-to-head matchup context ("I'm playing Team X this week") | Requires `/league/{id}/matchups/{week}` + knowing which roster the user owns |
| Win probability | Needs projected points — external data source |
| Trade value using league-specific scoring settings | Needs `/league/{id}` settings parsing |

The biggest remaining gap is knowing **which roster belongs to the logged-in
user** — currently the agent knows all rosters but not which one is "yours".
This would require the user to identify their team name or roster ID, which
could be added as a one-time setup step in the Connect Sleeper panel.