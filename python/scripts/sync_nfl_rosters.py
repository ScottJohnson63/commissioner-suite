"""Season roster sync — jersey numbers for the card game.

nflverse publishes jersey numbers on the roster feed, not the player-stat feed,
so NflWeeklyStat cannot supply them and the card game needs its own small table.
One row per player per season: exactly what "the number he wore that season"
means.

This is deliberately narrow. The roster feed is far wider than this; only the
columns the cards print are kept.

Safe to re-run: rows are upserted on (season, playerId), nothing is truncated.

Usage:
  python scripts/sync_nfl_rosters.py             # every season in NflWeeklyStat
  python scripts/sync_nfl_rosters.py 1999 2022   # an explicit range

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
"""
from __future__ import annotations

import sys

import nflreadpy as nfl
import polars as pl

from common import localenv, syncrun, turso

EARLIEST_SEASON = 1999


def seasons_in_database() -> list[int]:
    """The seasons the stat table already holds — what the cards are built from.

    Syncing rosters for a season with no stats would be wasted rows: a card only
    exists where a stat line does.
    """
    rows = turso.query('SELECT DISTINCT season FROM "NflWeeklyStat" ORDER BY season')
    return [int(r["season"]) for r in rows]


def parse_args(argv: list[str]) -> list[int] | None:
    """An explicit inclusive range, or None to follow the stat table."""
    if not argv:
        return None
    if len(argv) > 2:
        raise SystemExit(__doc__)

    try:
        start = int(argv[0])
        end = int(argv[1]) if len(argv) == 2 else start
    except ValueError:
        raise SystemExit(f"Seasons must be years, got: {' '.join(argv)}")

    if start < EARLIEST_SEASON:
        raise SystemExit(f"nflverse has no rosters before {EARLIEST_SEASON}.")
    if start > end:
        raise SystemExit(f"{start} is after {end}.")

    return list(range(start, end + 1))


def upsert(df: pl.DataFrame) -> int:
    """Upserts jersey numbers keyed on (season, playerId)."""
    sql = (
        'INSERT INTO "NflSeasonRoster" (id, season, "playerId", "jerseyNumber", team) '
        "VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?) "
        'ON CONFLICT (season, "playerId") DO UPDATE SET '
        '"jerseyNumber" = excluded."jerseyNumber", team = excluded.team, '
        '"syncedAt" = CURRENT_TIMESTAMP'
    )
    rows = [
        [r["season"], r["gsis_id"], r["jersey_number"], r["team"]]
        for r in df.to_dicts()
    ]
    return turso.execute_chunked(sql, rows, label="roster rows")


def main() -> None:
    # Fail on a missing credential now, not after a season has downloaded.
    localenv.require("TURSO_DATABASE_URL")

    seasons = parse_args(sys.argv[1:]) or seasons_in_database()
    if not seasons:
        raise SystemExit("No seasons to sync — NflWeeklyStat is empty.")

    print(f"Syncing rosters for {len(seasons)} season(s): {seasons[0]}–{seasons[-1]}")

    with syncrun.record(syncrun.NFL_WEEKLY) as run:
        total = 0

        # One season per fetch, so an interrupted run keeps what it finished.
        for year in seasons:
            df = nfl.load_rosters([year])

            # A GSIS id is the only way to join back to the stat table, and a
            # jersey number is the only column we are here for. Rows missing
            # either are of no use to a card.
            df = (
                df.select(["season", "gsis_id", "jersey_number", "team"])
                .filter(pl.col("gsis_id").is_not_null() & (pl.col("gsis_id") != ""))
                .filter(pl.col("jersey_number").is_not_null())
                .unique(subset=["season", "gsis_id"], keep="first")
            )

            written = upsert(df)
            total += written
            print(f"  {year}: {written} rows")

        run.note(operation="rosters", seasons=seasons)
        run.count(total)
        print(f"✓ Roster sync complete — {total} rows.")


if __name__ == "__main__":
    main()
