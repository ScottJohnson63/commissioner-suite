# Statistics Tab — Reference

The Statistics tab (`/league/dashboard` → Statistics) is the player data hub.
It has three sections: a trending ticker across the top, a stat leaders table in the main area,
and a statistics resources sidebar.

---

## Sleeper Trending Ticker

A slim banner directly below the tab bar. Rotates through trending players automatically.

| Detail | Value |
|--------|-------|
| Data source | Sleeper trending API |
| Cache | 10 min server-side (`/api/trending`) |
| Direction | Adds (▲ green) and drops (▼ orange) interleaved |
| Visible at once | 5 on desktop, 3 on mobile |
| Rotation interval | 10 seconds with 350 ms opacity fade |
| Per chip | Direction arrow · rank (`#1`) · headshot · name · position · team |
| Attribution | "Sleeper Trending" label links to sleeper.com |

Player info (name, position, team) is resolved via the 3-tier Sleeper player cache
(in-memory → `SleeperCache` DB row → Sleeper API). The full player list is fetched
at most once per 24 hours per Sleeper's API guidelines.

---

## NFL Stat Leaders Table

Season-aggregated leaders pulled from the local `NflWeeklyStat` database table,
populated by the NFL data sync script (`nflreadpy`).

**API route:** `GET /api/nfl/leaders?season=2025&stat=<col>&position=<pos>&limit=25`

### Controls

| Control | Behaviour |
|---------|-----------|
| Category dropdown | Grouped `<optgroup>` by stat family (see below) |
| Position pills | Filter to a single position; horizontally scrollable on mobile |
| Default | Fantasy Points (PPR), All positions |

### Stat categories

#### Fantasy
| Key | Label | Unit |
|-----|-------|------|
| `fantasyPointsPpr` | Fantasy Points (PPR) | pts |
| `fantasyPoints` | Fantasy Points (STD) | pts |

#### Passing
| Key | Label | Unit |
|-----|-------|------|
| `passingYards` | Passing Yards | yds |
| `passingTds` | Passing TDs | TD |
| `passingInterceptions` | Interceptions | — |
| `completions` | Completions | — |
| `attempts` | Pass Attempts | — |
| `passingAirYards` | Air Yards | yds |
| `passingYardsAfterCatch` | YAC | yds |
| `passingFirstDowns` | Pass 1st Downs | — |
| `sacksSuffered` | Sacks Taken | — |
| `passingEpa` | Passing EPA | — |
| `passingCpoe` | CPOE | % |
| `pacr` | PACR | — |

#### Rushing
| Key | Label | Unit |
|-----|-------|------|
| `rushingYards` | Rushing Yards | yds |
| `rushingTds` | Rushing TDs | TD |
| `carries` | Carries | — |
| `rushingFirstDowns` | Rush 1st Downs | — |
| `rushingEpa` | Rushing EPA | — |

#### Receiving
| Key | Label | Unit |
|-----|-------|------|
| `receivingYards` | Receiving Yards | yds |
| `receivingTds` | Receiving TDs | TD |
| `receptions` | Receptions | — |
| `targets` | Targets | — |
| `receivingAirYards` | Air Yards | yds |
| `receivingYardsAfterCatch` | YAC | yds |
| `receivingFirstDowns` | Rec 1st Downs | — |
| `receivingEpa` | Rec EPA | — |
| `targetShare` | Target Share | % |
| `airYardsShare` | Air Yards Share | % |
| `wopr` | WOPR | — |
| `racr` | RACR | — |

#### Defense
| Key | Label | Unit |
|-----|-------|------|
| `defTacklesSolo` | Solo Tackles | — |
| `defTacklesForLoss` | TFL | — |
| `defSacks` | Sacks | — |
| `defQbHits` | QB Hits | — |
| `defInterceptions` | INTs | — |
| `defPassDefended` | Pass Breakups | — |
| `defFumblesForced` | Forced Fumbles | — |
| `defTds` | Def TDs | TD |

#### Kicking
| Key | Label | Unit |
|-----|-------|------|
| `fgMade` | FG Made | — |
| `fgAtt` | FG Attempts | — |
| `patMade` | PAT Made | — |

### Position filter options

`All` · `QB` · `RB` · `WR` · `TE` · `DEF` · `K`

### Table columns

| Column | Mobile | Desktop |
|--------|--------|---------|
| Rank | ✓ | ✓ |
| Headshot + Name | ✓ | ✓ |
| Pos + Team + GP (inline, below name) | ✓ | — |
| Team | — | ✓ |
| Pos | — | ✓ |
| GP | — | ✓ |
| Stat value | ✓ | ✓ |

### Security note

`/api/nfl/leaders` uses `$queryRawUnsafe` for the dynamic stat column. This is safe because:
- The column name is validated against a hardcoded `ALLOWED_STAT_COLS` Set before use
- The position filter is regex-stripped to `/^[A-Z]{1,3}$/`
- `season` and `limit` are bound parameters (`?` placeholders)

---

## Statistics Resources Sidebar

A directory of 10 external sites, shown to the right of the table on desktop and below it on mobile.

| Site | URL | Focus |
|------|-----|-------|
| Pro Football Reference | pro-football-reference.com | Historical stats & records |
| StatMuse | statmuse.com/nfl | Natural language queries |
| NFL Next Gen Stats | nextgenstats.nfl.com | Official NGS tracking data |
| ESPN Stats | espn.com/nfl/stats | Season leaders & splits |
| Football Outsiders | footballoutsiders.com | DVOA & advanced metrics |
| 4th Down Analytics | rbsdm.com | EPA, CPOE, open-source |
| PFF | pff.com/nfl | Grades & premium analytics |
| FantasyPros | fantasypros.com/nfl | Rankings & projections |
| Rotowire | rotowire.com/football | Injury news & depth charts |
| The Athletic | theathletic.com/nfl | In-depth reporting |

---

## Data Requirements

The stat leaders table requires at least one successful run of the NFL data sync script.
Without synced data the table shows: *"No stats synced yet — run the NFL sync script to populate."*

The trending ticker requires a valid Sleeper connection but degrades gracefully —
if the Sleeper player cache is unavailable, player names fall back to the raw `player_id`.
