# Agent Intent Test Prompts

For each prompt, check the response headers in devtools:
- **`X-Query-Intent`** — should match the expected intent
- **`X-League-Context`** — should be `true` for Sleeper-connected intents
- **Response** — should use the correct data source

---

## `general`

```
What are some general fantasy football tips?
```

**Expected:** `X-Query-Intent: general` · `X-League-Context: false`

---

## `top_position`

```
Who were the best running backs last season?
```

```
Who are the top wide receivers this year?
```

**Expected:** `X-Query-Intent: top_position` · `X-League-Context: false`
**Check:** Response ranks players by season total points with games played noted.

---

## `player_recent`

```
How has Lamar Jackson been performing lately?
```

**Expected:** `X-Query-Intent: player_recent` · `X-League-Context: false`
**Check:** Response references specific recent weeks, not season totals.

---

## `player_comparison`

```
Should I start Josh Allen or Jalen Hurts this week?
```

**Expected:** `X-Query-Intent: player_comparison` · `X-League-Context: false`
**Check:** Response compares recent game logs for both players side by side.

---

## `player_vs_opponent`

```
How has Patrick Mahomes historically played against the Bills?
```

**Expected:** `X-Query-Intent: player_vs_opponent` · `X-League-Context: false`
**Check:** Response references specific matchup games, not general season stats.

---

## `air_yards_efficiency`

```
Which wide receivers have the most air yards but few catches over the last 2 weeks?
```

**Expected:** `X-Query-Intent: air_yards_efficiency` · `X-League-Context: false`
**Check:** Response includes aDOT, air yards, and reception numbers.

---

## `workload_trend`

```
Is Saquon Barkley's workload declining as the season goes on?
```

**Expected:** `X-Query-Intent: workload_trend` · `X-League-Context: false`
**Check:** Response references carries/touches in chronological week order.

---

## `efficiency_gap`

```
Which wide receivers are getting lots of targets but underperforming? I'm looking for buy-low candidates.
```

**Expected:** `X-Query-Intent: efficiency_gap` · `X-League-Context: false`
**Check:** Response identifies players with high target counts and low fantasy points.

---

## `standings` ⚡ Requires Sleeper connected

```
Who is in last place in our league?
```

```
What are the current league standings?
```

**Expected:** `X-Query-Intent: standings` · `X-League-Context: true`
**Check:** Response names real teams from your Sleeper league with accurate W-L records.

---

## `roster_scan` ⚡ Requires Sleeper connected

```
Which managers in our league have weak running back rooms?
```

**Expected:** `X-Query-Intent: roster_scan` · `X-League-Context: true`
**Check:** Response references actual team names and rostered players from your league.

---

## `playoff_schedule` ⚡ Requires Sleeper connected

```
Who has the easiest schedule heading into the fantasy playoffs?
```

**Expected:** `X-Query-Intent: playoff_schedule` · `X-League-Context: true`
**Check:** Response references upcoming NFL matchups and league standings together.

---

## `trending`

```
Who should I be targeting on the waiver wire this week?
```

**Expected:** `X-Query-Intent: trending` · `X-League-Context: false`
**Check:** Response references Sleeper trending adds data.

---

## Missing league test ⚡ Disconnect Sleeper first

Run this in the browser console to disconnect, then ask a league question:
```js
localStorage.clear()
```

```
What are the current league standings?
```

**Expected:** Response should tell you to connect your Sleeper account via the button in the top-right. Should NOT just give generic fantasy advice.