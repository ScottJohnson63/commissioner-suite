"""Loads the season that just finished — August 1st.

Every August the NFL season that ran the previous autumn is complete and
corrected, so it is pulled in full and added to NflWeeklyStat.

This used to be a *reset*: it truncated the table and reloaded a rolling window
of recent seasons. That made sense when the app only cared about the last three
years, and became actively harmful once the card game arrived — the pool is
built from every season in the table, so a truncate threw away history the game
depends on, and a 1999+ backfill (four hours of uploads) was destroyed by the
next August run. Nothing is deleted any more. The table only grows.

Why reload a whole season rather than trusting the weekly sync: the weekly job
moves one week at a time and only while the season window is open, so it can
miss a week to an outage and never carries the corrections nflverse applies
after the fact. Re-pulling the finished season upserts over all of that.

Safe to re-run: rows are upserted on (season, week, playerId).

Usage:
  python scripts/load_completed_season.py        # the season that just ended
  python scripts/load_completed_season.py 2019   # a specific one, run by hand

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  FORCE                                — "true" bypasses the August 1 check
"""
from __future__ import annotations

import sys

from common import localenv, nflstats, season, syncrun

# nflverse player-stat coverage begins here.
EARLIEST_SEASON = 1999


def target_season(argv: list[str]) -> int:
    """The season to load: an explicit argument, or the one that just ended."""
    if not argv:
        return season.last_completed_season()
    if len(argv) > 1:
        raise SystemExit(__doc__)

    try:
        year = int(argv[0])
    except ValueError:
        raise SystemExit(f"Season must be a year, got: {argv[0]}")

    if year < EARLIEST_SEASON:
        raise SystemExit(f"nflverse has no player stats before {EARLIEST_SEASON}.")
    return year


def main() -> None:
    # Fail on a missing credential now, not after a season has downloaded.
    localenv.require("TURSO_DATABASE_URL")

    year = target_season(sys.argv[1:])

    with syncrun.record(syncrun.NFL_SEASON_RESET) as run:
        # The SyncSource above is still NFL_SEASON_RESET. It is a stored value on
        # every historical SyncRun row, so renaming it would orphan that history
        # for the sake of a label; the Data Sync screen describes what the job
        # actually does.
        if not season.is_reset_day():
            reason = f"Not the annual load date ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        print(f"Loading the {year} season…")
        df = nflstats.load_seasons([year])
        print(f"  {len(df)} rows, {len(df.columns)} columns")

        run.note(season=year, operation="load-completed-season")
        run.count(nflstats.upsert(df))
        print(f"✓ {year} loaded. Nothing was deleted.")


if __name__ == "__main__":
    main()
