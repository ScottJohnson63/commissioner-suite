"""Weekly NFL stat sync — Tuesdays at 08:00 UTC, in season only.

Pulls the most recently published week from nflverse and upserts it into
NflWeeklyStat. Only one week moves per run, so the job stays small and cheap
even though the source file covers the whole season.

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — season to sync (defaults to this year)
  FORCE                                — "true" bypasses the season window
"""
from __future__ import annotations

from common import nflstats, season, syncrun


def main() -> None:
    with syncrun.record(syncrun.NFL_WEEKLY) as run:
        if not season.is_in_season():
            reason = f"Outside the NFL season window ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        current = season.current_season()
        print(f"Fetching {current} season stats...")
        df, week = nflstats.load_latest_week(current)
        print(f"  Most recent week: {week} ({len(df)} rows)")

        run.note(season=current, week=week)
        run.count(nflstats.upsert(df))
        print("✓ Weekly sync complete.")


if __name__ == "__main__":
    main()
