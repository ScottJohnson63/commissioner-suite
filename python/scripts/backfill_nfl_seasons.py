"""Historical stat backfill — a one-off, run by hand.

Loads whole seasons of nflverse player stats into NflWeeklyStat. The weekly sync
only moves the newest week and the August job only adds the season that just
finished, so neither of them can reach back into NFL history. This is
the job that does, and it exists for the card game: the size of the card pool —
and so the weekly pack allowance — is a function of how many seasons the table
holds.

nflverse publishes player stats from 1999 onwards, with the same 150 columns and
complete headshot coverage for every one of those years, so old seasons need no
special handling. They are simply large: roughly 17,000 rows a season.

Nothing is ever truncated. Rows are upserted on (season, week, playerId), so
re-running a season is idempotent and a backfill that dies partway through can
be restarted by issuing the same command.

A season already present with the same row count is skipped, so re-running a
range costs one quick download per finished season instead of re-uploading it.
Pass --force to upload anyway, which is what you want after nflverse publishes
corrections to a season you already have.

Usage:
  python scripts/backfill_nfl_seasons.py 1999 2022            # a range, inclusive
  python scripts/backfill_nfl_seasons.py 2019                 # a single season
  python scripts/backfill_nfl_seasons.py 2019 --force         # re-upload it


Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
"""
from __future__ import annotations

import sys

from common import localenv, nflstats, season, syncrun

# nflverse player-stat coverage begins here.
EARLIEST_SEASON = 1999


def parse_args(argv: list[str]) -> list[int]:
    """Turns the command line into an inclusive list of seasons."""
    if not argv or len(argv) > 2:
        raise SystemExit(__doc__)

    try:
        start = int(argv[0])
        end = int(argv[1]) if len(argv) == 2 else start
    except ValueError:
        raise SystemExit(f"Seasons must be years, got: {' '.join(argv)}")

    latest = season.current_season()
    if start < EARLIEST_SEASON:
        raise SystemExit(f"nflverse has no player stats before {EARLIEST_SEASON}.")
    if end > latest:
        raise SystemExit(f"{end} is past the current season ({latest}).")
    if start > end:
        raise SystemExit(f"{start} is after {end}.")

    return list(range(start, end + 1))


def main() -> None:
    # Fail on a missing credential now, not after a season has downloaded.
    localenv.require("TURSO_DATABASE_URL")

    argv = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]

    seasons = parse_args(argv)
    print(f"Backfilling {len(seasons)} season(s): {seasons[0]}–{seasons[-1]}")
    if force:
        print("--force: re-uploading seasons even if they are already loaded.")

    # What is already loaded, so a resumed run skips straight past it.
    existing = {} if force else nflstats.rows_per_season()

    with syncrun.record(syncrun.NFL_WEEKLY) as run:
        total = 0
        skipped: list[int] = []

        # One season per fetch rather than one fetch for all of them: a 27-season
        # request is gigabytes of dataframe held at once, and loading them one at
        # a time means an interrupted backfill keeps every season it finished.
        for year in seasons:
            df = nflstats.load_seasons([year])

            # Downloading a season is seconds; uploading it is minutes. So the
            # check happens after the fetch, where the real row count is known,
            # rather than guessing completeness from what is already stored.
            if existing.get(year) == len(df):
                skipped.append(year)
                print(f"  {year}… already loaded ({len(df)} rows), skipping")
                continue

            print(f"  {year}… {len(df)} rows", flush=True)
            total += nflstats.upsert(df)

        run.note(operation="backfill", seasons=seasons, skipped=skipped)
        run.count(total)

        loaded = len(seasons) - len(skipped)
        summary = f"✓ Backfill complete — {total} rows across {loaded} season(s)."
        if skipped:
            summary += f" {len(skipped)} already loaded and skipped."
        print(summary)


if __name__ == "__main__":
    main()
