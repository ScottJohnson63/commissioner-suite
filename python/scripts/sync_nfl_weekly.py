"""Weekly NFL stat sync — Tuesdays at 08:00 UTC, in season only.

Pulls the most recently published week from nflverse and upserts it into
NflWeeklyStat. Only one week moves per run, so the job stays small and cheap
even though the source file covers the whole season.

FULL_SEASON=true loads every published week of the season instead of the newest
one. That is the catch-up: the scheduled run moves one week, so a season the job
missed entirely — as 2026 was, while the workflow pinned NFL_SEASON to 2025 —
never fills in by itself. Upserts are keyed on (season, week, playerId), so it
is safe to run over weeks that are already stored.

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — overrides the season worked out from
                                         the calendar; see common/season.py
  FULL_SEASON                          — "true" loads every published week
  FORCE                                — "true" bypasses the season window
"""
from __future__ import annotations

import os

from common import appcache, nflstats, season, syncrun


def full_season() -> bool:
    """True when this run should load the whole season rather than one week."""
    return os.environ.get("FULL_SEASON", "false").lower() == "true"


def main() -> None:
    with syncrun.record(syncrun.NFL_WEEKLY) as run:
        if not season.is_in_season():
            reason = f"Outside the NFL season window ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        current = season.current_season()
        print(f"Fetching {current} season stats...")

        if full_season():
            df = nflstats.load_seasons([current])
            print(f"  Every published week ({len(df)} rows)")
            run.note(season=current, weeks="all")
        else:
            df, week = nflstats.load_latest_week(current)
            print(f"  Most recent week: {week} ({len(df)} rows)")
            run.note(season=current, week=week)

        run.count(nflstats.upsert(df))

        # The app caches the list of seasons the table holds; a sync is the only
        # thing that moves it. See common/appcache.py.
        appcache.drop_stat_seasons()
        print("✓ Weekly sync complete.")


if __name__ == "__main__":
    main()
