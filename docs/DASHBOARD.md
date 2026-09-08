# League Dashboard — Usage Guide

The league dashboard (`/league/dashboard`) is the central hub for the Commissioner Suite.
It is organized into five tabs: **Matchup**, **Waivers** and **Trades**, which each need a
Sleeper account connection, then **Statistics** and **News**, which anybody can read.

---

## First-Time Setup

On first visit a modal prompts for your **Sleeper username**.

1. Enter your Sleeper username (case-insensitive).
2. Click **Connect** — the app resolves it to your stable `user_id` and stores both in `localStorage`.
3. Your leagues for the current season are loaded automatically.

Your session persists across page refreshes. To switch accounts, click **disconnect** next to your name in the header.

> The app stores `sleeper_user_id` (primary) and `sleeper_username` (fallback) following Sleeper's recommendation to use the stable user ID rather than the mutable username.

---

## Tabs

### Matchup, Waivers and Trades

The three tabs about your own team, each read live from Sleeper for whichever league is
picked in the dropdown at the top. Use that dropdown to switch between your leagues; it
shows each league's **status dot**:

| Colour | Status |
|--------|--------|
| 🟢 Green | In season |
| 🟡 Yellow | Pre-draft |
| 🔵 Blue | Drafting |
| ⚫ Grey | Complete |

| Tab | What it holds |
|-----|---------------|
| Matchup | Your starters against this week's opponent, with each side's boom and bust range |
| Waivers | Free agents worth a claim, ranked against your thinnest positions |
| Trades | Trades that fit both rosters, labelled by how likely they are to be accepted |

Each panel loads on demand — press its button when you want the numbers, so nothing burns
a Sleeper call you did not ask for.

---

### Statistics

Live player data from two sources.

#### Trending (via Sleeper)

Two columns — **Most Added** and **Most Dropped** — pulled from Sleeper's trending
endpoint over the past 24 hours. Each card shows:

- Player headshot (Sleeper CDN)
- Full name, position tag, and team
- Add/drop count

Data is cached server-side for **10 minutes** to stay within Sleeper's rate limits.
Attribution link to Sleeper is displayed inline per their API terms.

#### Top Performers (NFL stats)

Ranked by PPR fantasy points, sourced from the local `NflWeeklyStat` database table.
Populated via the NFL data sync script. Requires at least one sync run to show data.

---

### News

#### NFL Headlines (left — 2 columns)

Aggregated from four RSS feeds, merged and sorted newest-first.
Use the **source filter pills** to narrow by outlet:

| Pill | Source | RSS endpoint |
|------|--------|--------------|
| All | All four feeds | — |
| ESPN | ESPN NFL | `espn.com/espn/rss/nfl/news` |
| Yahoo Sports | Yahoo Sports NFL | `sports.yahoo.com/nfl/rss.xml` |
| Pro Football Talk | NBC Sports / PFT | `nbcsports.com/profootballtalk.rss` |
| CBS Sports | CBS Sports NFL | `cbssports.com/rss/headlines/nfl/` |

Each article shows:
- Thumbnail image (if available)
- Title with source-coloured badge
- Relative timestamp (e.g. *2h ago*, *3d ago*)

Feeds are cached **15 minutes** per source. Stale cache is served on fetch failure
rather than showing an error, so headlines remain visible during brief outages.

#### NFL Reporters on X (right column)

A directory of 12 top NFL insiders with direct links to their X profiles.
Hovering a row reveals an arrow link.

| Reporter | Handle | Outlet |
|----------|--------|--------|
| Adam Schefter | @AdamSchefter | ESPN |
| Ian Rapoport | @RapSheet | NFL Network |
| Tom Pelissero | @TomPelissero | NFL Network |
| Jay Glazer | @JayGlazer | Fox Sports |
| Mike Garafolo | @MikeGarafolo | NFL Network |
| Jeremy Fowler | @JFowlerESPN | ESPN |
| Diana Russini | @dianaussini | The Athletic |
| Albert Breer | @AlbertBreer | SI / MMQB |
| Field Yates | @FieldYates | ESPN |
| Mike Florio | @ProFootballTalk | NBC Sports |
| Jordan Schultz | @Schultz_Report | Independent |
| Dan Graziano | @DanGrazianoESPN | ESPN |

> Live tweet feeds are not available without a paid X API subscription ($100/month minimum).
> The directory links directly to each reporter's profile.

---

## API Routes

| Route | Description | Cache |
|-------|-------------|-------|
| `GET /api/sleeper/user?username=` | Resolve Sleeper username → user + leagues | 5 min |
| `GET /api/sleeper/user?userId=` | Same, by stable user ID (preferred) | 5 min |
| `GET /api/trending?limit=10` | Sleeper trending adds + drops | 10 min (server) |
| `GET /api/news` | All four RSS feeds merged | 15 min per source |
| `GET /api/news?source=espn` | Single source (`espn`, `yahoo`, `pft`, `cbs`) | 15 min |
| `GET /api/nfl/weekly?season=2025&limit=20` | Top PPR performers from local DB | DB query |

---

## localStorage Keys

| Key | Value |
|-----|-------|
| `sleeper_user_id` | Stable Sleeper user ID (primary session key) |
| `sleeper_username` | Sleeper username (fallback if user_id missing) |
| `sleeper_active_league` | League ID of the currently selected league |
| `sleeper_active_league_name` | Display name of the selected league |
| `schedule_week` | Last-viewed week on the Schedule page |

Clear all keys with `localStorage.clear()` in the browser console to reset the session.

---

## Schedule Page (`/league/schedule`)

Reads `sleeper_active_league` to load the current league's matchups.
Week selector (1–18) persists to `schedule_week`.
Matchup scores are live from Sleeper — no local sync required.
