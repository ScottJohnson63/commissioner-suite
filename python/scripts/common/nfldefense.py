"""Building team-defense rows for NflWeeklyStat.

nflverse publishes no DEF position: `load_player_stats` covers people, and a
fantasy defense is a team. So the rows are assembled here from two other feeds
and written into the same table under `position = 'DEF'`, keyed on the team
abbreviation.

Why the same table rather than a new one: Sleeper's own DEF player ids *are* team
abbreviations ("BAL"), so a defense stored this way joins to a roster through
exactly the same cross-reference, week window and projection path as a running
back. A parallel table would need all of that duplicated.

Two derivations are worth stating outright, because neither is a column anyone
publishes:

  * Fumble recoveries are the opponent's `fumbles_lost_total`. A fumble lost by
    an offense is a fumble recovered by the defense facing it. The team feed's
    own `def_fumbles` is something else entirely — 44 league-wide in 2025, where
    recoveries were 249.
  * Yards allowed are the opponent's passing plus rushing yards. Sleeper counts
    total net offensive yards; this is the closest figure the feed carries.

Fantasy points are deliberately left NULL. Every league in this app scores
defenses differently enough that the totals are computed per league at read time
— see src/lib/scoring.ts.
"""
from __future__ import annotations

import nflreadpy as nfl
import polars as pl

from common import turso

# Columns carried straight from the team feed → NflWeeklyStat.
DEFENSE_COLUMNS: dict[str, str] = {
    "def_sacks":          "defSacks",
    "def_interceptions":  "defInterceptions",
    "def_fumbles_forced": "defFumblesForced",
    "def_tds":            "defTds",
    "def_safeties":       "defSafeties",
    "def_punt_blocks":    "defPuntBlocks",
    "def_pat_blocks":     "defPatBlocks",
    "def_fg_blocks":      "defFgBlocks",
    "def_qb_hits":        "defQbHits",
    "def_tackles_solo":   "defTacklesSolo",
    "def_pass_defended":  "defPassDefended",
}

# Written as-is on every row.
POSITION = "DEF"

KEY_COLUMNS = frozenset({"season", "week", "playerId"})
TEXT_COLUMNS = frozenset({
    "playerId", "playerName", "playerDisplayName", "position",
    "positionGroup", "seasonType", "team", "opponentTeam",
})


def _scores(seasons: list[int]) -> pl.DataFrame:
    """Points scored by each team in each game, one row per team per week."""
    games = nfl.load_schedules(seasons=seasons).select(
        ["season", "game_type", "week", "home_team", "home_score", "away_team", "away_score"]
    )
    home = games.select(
        pl.col("season"), pl.col("game_type"), pl.col("week"),
        pl.col("home_team").alias("team"),
        pl.col("home_score").alias("scored"),
    )
    away = games.select(
        pl.col("season"), pl.col("game_type"), pl.col("week"),
        pl.col("away_team").alias("team"),
        pl.col("away_score").alias("scored"),
    )
    # A game not yet played has a null score and no defense row to write.
    return pl.concat([home, away]).drop_nulls("scored")


def published(seasons: list[int]) -> list[int]:
    """The subset of `seasons` nflverse has actually released team stats for.

    A season that has not kicked off yet has no file, and nflreadpy raises a
    404 rather than returning nothing. Asking first turns "the season starts in
    nine days" from a crashed job into a skipped one.
    """
    have = []
    for year in seasons:
        try:
            nfl.load_team_stats(seasons=[year])
            have.append(year)
        except Exception as exc:  # noqa: BLE001 - any download failure means "not yet"
            print(f"  {year}: no team stats published yet ({type(exc).__name__})")
    return have


def build(seasons: list[int]) -> pl.DataFrame:
    """Assembles one DEF row per team per completed game.

    Returns an empty frame when nflverse has published none of `seasons`.
    """
    seasons = published(seasons)
    if not seasons:
        return pl.DataFrame()

    teams = nfl.load_team_stats(seasons=seasons)

    keep = [c for c in DEFENSE_COLUMNS if c in teams.columns]
    offense = ["passing_yards", "rushing_yards", "fumbles_lost_total"]

    base = teams.select(
        ["season", "week", "season_type", "team", "opponent_team", *keep, *offense]
    )

    # What each team conceded is what its opponent produced, so the frame is
    # joined to itself on (season, week, team = the other side's opponent).
    opponent = base.select(
        pl.col("season"), pl.col("week"),
        pl.col("team").alias("opponent_team"),
        (pl.col("passing_yards") + pl.col("rushing_yards")).alias("yardsAllowed"),
        pl.col("fumbles_lost_total").alias("defFumbles"),
    )

    rows = base.join(opponent, on=["season", "week", "opponent_team"], how="left")

    scores = _scores(seasons).select(
        pl.col("season"), pl.col("week"),
        pl.col("team").alias("opponent_team"),
        pl.col("scored").alias("pointsAllowed"),
    )
    rows = rows.join(scores, on=["season", "week", "opponent_team"], how="left")

    rows = rows.rename({src: dst for src, dst in DEFENSE_COLUMNS.items() if src in keep})

    names = nfl.load_teams().select(
        pl.col("team_abbr").alias("team"),
        pl.col("team_name").alias("fullName"),
    )
    rows = rows.join(names, on="team", how="left")

    rows = rows.with_columns([
        pl.col("team").alias("playerId"),
        pl.coalesce([pl.col("fullName"), pl.col("team")]).alias("playerDisplayName"),
        pl.coalesce([pl.col("fullName"), pl.col("team")]).alias("playerName"),
        pl.lit(POSITION).alias("position"),
        pl.lit(POSITION).alias("positionGroup"),
        pl.col("season_type").alias("seasonType"),
        pl.col("opponent_team").alias("opponentTeam"),
    ]).drop(["fullName", "season_type", "opponent_team", *offense])

    # A defense with no game on record cannot be scored, and a null would read
    # as a shutout rather than as an absence.
    rows = rows.drop_nulls("pointsAllowed")

    return rows.with_columns([
        pl.col(c).cast(pl.Float64, strict=False)
        for c in rows.columns
        if c not in TEXT_COLUMNS and c not in ("season", "week")
    ])


def upsert(df: pl.DataFrame) -> int:
    """Upserts the DEF rows, keyed on (season, week, playerId) like every other."""
    cols = df.columns
    col_names = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(f'"{c}" = excluded."{c}"' for c in cols if c not in KEY_COLUMNS)

    sql = (
        f"INSERT INTO NflWeeklyStat (id, {col_names}) "
        f"VALUES (lower(hex(randomblob(16))), {placeholders}) "
        f'ON CONFLICT (season, week, "playerId") DO UPDATE SET {updates}'
    )
    rows = [[row[c] for c in cols] for row in df.to_dicts()]
    return turso.execute_chunked(sql, rows, label="defense rows")
