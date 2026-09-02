"""Loading NFL fixtures into NflGame.

Who plays whom in a given week, and where. Nothing in the app knew this:
Sleeper's /schedule endpoint now 404s, and nflverse ships schedules as a parquet
download that a Next.js request path cannot make, so the fixtures are synced
here and read from the database.

Schedules are published months ahead, so this works for a season that has not
kicked off — which is the case it exists for. Scores fill in as games are played
and the row is upserted over.
"""
from __future__ import annotations

import nflreadpy as nfl
import polars as pl

from common import turso

# nflverse source column → NflGame column.
COLUMN_MAP: dict[str, str] = {
    "season":     "season",
    "week":       "week",
    "game_type":  "seasonType",
    "home_team":  "homeTeam",
    "away_team":  "awayTeam",
    "stadium":    "stadium",
    "roof":       "roof",
    "location":   "location",
    "home_score": "homeScore",
    "away_score": "awayScore",
}

KEY_COLUMNS = frozenset({"season", "week", "homeTeam"})
NUMERIC_COLUMNS = frozenset({"homeScore", "awayScore"})


def published(seasons: list[int]) -> list[int]:
    """The subset of `seasons` nflverse has released a schedule for."""
    have = []
    for year in seasons:
        try:
            nfl.load_schedules(seasons=[year])
            have.append(year)
        except Exception as exc:  # noqa: BLE001 - any download failure means "not yet"
            print(f"  {year}: no schedule published yet ({type(exc).__name__})")
    return have


def build(seasons: list[int]) -> pl.DataFrame:
    """One row per fixture, ready to upsert. Empty when nothing is published."""
    seasons = published(seasons)
    if not seasons:
        return pl.DataFrame()

    games = nfl.load_schedules(seasons=seasons)
    keep = [c for c in COLUMN_MAP if c in games.columns]
    df = games.select(keep).rename({c: COLUMN_MAP[c] for c in keep})

    # gameday and gametime are separate strings; the app wants one sortable
    # timestamp so a forecast can be read at kickoff rather than at a guess.
    if "gameday" in games.columns and "gametime" in games.columns:
        df = df.with_columns(
            pl.when(games["gameday"].is_null() | games["gametime"].is_null())
              .then(None)
              .otherwise(games["gameday"] + "T" + games["gametime"])
              .alias("kickoff")
        )

    df = df.filter(pl.col("homeTeam").is_not_null() & pl.col("awayTeam").is_not_null())

    return df.with_columns([
        pl.col(c).cast(pl.Float64, strict=False)
        for c in df.columns if c in NUMERIC_COLUMNS
    ])


def upsert(df: pl.DataFrame) -> int:
    """Upserts fixtures keyed on (season, week, homeTeam)."""
    cols = df.columns
    col_names = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(f'"{c}" = excluded."{c}"' for c in cols if c not in KEY_COLUMNS)

    sql = (
        f"INSERT INTO NflGame (id, {col_names}, \"syncedAt\") "
        f"VALUES (lower(hex(randomblob(16))), {placeholders}, CURRENT_TIMESTAMP) "
        f'ON CONFLICT (season, week, "homeTeam") DO UPDATE SET {updates}, '
        f'"syncedAt" = CURRENT_TIMESTAMP'
    )
    rows = [[row[c] for c in cols] for row in df.to_dicts()]
    return turso.execute_chunked(sql, rows, label="fixtures")
