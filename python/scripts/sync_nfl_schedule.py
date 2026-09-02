"""Loads NFL fixtures into NflGame.

Who plays whom, where, and when. See common/nflschedule.py for why this is
synced rather than fetched live.

Safe to re-run: fixtures are upserted on (season, week, homeTeam) and nothing is
deleted. Re-running mid-season fills in scores.

Usage:
  python scripts/sync_nfl_schedule.py             # the current season
  python scripts/sync_nfl_schedule.py 2026        # a specific one
  python scripts/sync_nfl_schedule.py 2025 2026   # an inclusive range

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — defaults the season when none is given
  FORCE                                — "true" bypasses the season-window check
"""
from __future__ import annotations

import sys

from common import localenv, nflschedule, season, syncrun

EARLIEST_SEASON = 1999


def target_seasons(argv: list[str]) -> list[int]:
    """The seasons to load: none, one, or an inclusive range."""
    if not argv:
        return [season.current_season()]
    if len(argv) > 2:
        raise SystemExit(__doc__)
    try:
        years = [int(a) for a in argv]
    except ValueError:
        raise SystemExit(f"Seasons must be years, got: {' '.join(argv)}")
    for year in years:
        if year < EARLIEST_SEASON:
            raise SystemExit(f"nflverse has no schedules before {EARLIEST_SEASON}.")
    if len(years) == 1:
        return years
    start, end = sorted(years)
    return list(range(start, end + 1))


def main() -> None:
    localenv.require("TURSO_DATABASE_URL")
    seasons = target_seasons(sys.argv[1:])

    with syncrun.record(syncrun.NFL_SCHEDULE) as run:
        if not season.is_in_season():
            reason = f"Outside the season window ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        label = seasons[0] if len(seasons) == 1 else f"{seasons[0]}-{seasons[-1]}"
        print(f"Loading fixtures for {label}…")
        df = nflschedule.build(seasons)
        if df.is_empty():
            reason = f"nflverse has published no schedule for {label} yet."
            print(reason)
            run.skip(reason)
            return

        print(f"  {len(df)} fixtures")
        run.note(season=seasons[-1], operation="sync-nfl-schedule")
        run.count(nflschedule.upsert(df))
        print(f"✓ {label} fixtures loaded.")


if __name__ == "__main__":
    main()
