"""Loads team-defense rows into NflWeeklyStat.

nflverse has no DEF position — its player stats cover people, and a fantasy
defense is a team — so these rows are assembled from the team feed, the schedule
and the opposing offence. See common/nfldefense.py for the two derivations that
are not straight column copies (fumble recoveries and yards allowed).

Rows are keyed on (season, week, playerId) with playerId set to the team
abbreviation, which is also Sleeper's own DEF player id. That is what lets a
defense join to a roster through the same path as any other player.

Safe to re-run: every row is upserted and nothing is deleted.

Usage:
  python scripts/sync_nfl_defense.py             # the current season
  python scripts/sync_nfl_defense.py 2025        # a specific one
  python scripts/sync_nfl_defense.py 2022 2025   # an inclusive range

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — defaults the season when none is given
  FORCE                                — "true" bypasses the season-window check
"""
from __future__ import annotations

import sys

from common import localenv, nfldefense, season, syncrun

# nflverse team stats begin here, same as its player stats.
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
            raise SystemExit(f"nflverse has no team stats before {EARLIEST_SEASON}.")

    if len(years) == 1:
        return years
    start, end = sorted(years)
    return list(range(start, end + 1))


def main() -> None:
    localenv.require("TURSO_DATABASE_URL")

    seasons = target_seasons(sys.argv[1:])

    with syncrun.record(syncrun.NFL_DEFENSE) as run:
        if not season.is_in_season():
            reason = f"Outside the season window ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        label = seasons[0] if len(seasons) == 1 else f"{seasons[0]}-{seasons[-1]}"
        print(f"Building team defense rows for {label}…")
        df = nfldefense.build(seasons)
        if df.is_empty():
            reason = f"nflverse has published no team stats for {label} yet."
            print(reason)
            run.skip(reason)
            return

        print(f"  {len(df)} rows, {len(df.columns)} columns")

        run.note(season=seasons[-1], operation="sync-nfl-defense")
        run.count(nfldefense.upsert(df))
        print(f"✓ {label} defenses loaded. Nothing was deleted.")


if __name__ == "__main__":
    main()
