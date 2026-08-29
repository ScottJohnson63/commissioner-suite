"""Season reset — August 1st.

Clears NflWeeklyStat and reloads the last three seasons from nflverse. This is
the only job that deletes stat rows; the weekly sync only ever upserts, so
without a yearly reset the table would keep stale players and retired seasons
forever.

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — newest season to load
  FORCE                                — "true" bypasses the date check
"""
from __future__ import annotations

from common import nflstats, season, syncrun

SEASONS_TO_LOAD = 3


def main() -> None:
    with syncrun.record(syncrun.NFL_SEASON_RESET) as run:
        if not season.is_reset_day():
            reason = f"Not the reset date ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        current = season.current_season()
        seasons = list(range(current - SEASONS_TO_LOAD + 1, current + 1))
        print(f"Reloading seasons: {seasons}")

        nflstats.truncate()

        df = nflstats.load_seasons(seasons)
        print(f"  {len(df)} rows, {len(df.columns)} columns")

        run.note(seasons=seasons)
        run.count(nflstats.upsert(df))
        print("✓ Season reset complete.")


if __name__ == "__main__":
    main()
