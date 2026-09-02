"""Season-window guards and shared environment config.

Every sync job is scheduled year-round by GitHub Actions but should only touch
the database while the NFL season is running. Centralising the window here keeps
the four scripts from drifting apart on what "in season" means.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

# August 1 through February 1 (inclusive) — preseason through the Super Bowl.
SEASON_START_MONTH = 8
SEASON_END_MONTH = 2
SEASON_END_DAY = 1

# The season is reloaded from scratch on this date each year.
RESET_MONTH = 8
RESET_DAY = 1


def now() -> datetime:
    return datetime.now(timezone.utc)


def current_season() -> int:
    return int(os.environ.get("NFL_SEASON", str(now().year)))


def forced() -> bool:
    """True when FORCE=true, which bypasses the date guards for manual runs."""
    return os.environ.get("FORCE", "false").lower() == "true"


def trigger() -> str:
    """How this run was started — recorded on the SyncRun row.

    GitHub sets GITHUB_EVENT_NAME to `workflow_dispatch` for manual runs and
    `schedule` for cron runs.
    """
    return "manual" if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" else "schedule"


def is_in_season(today: datetime | None = None) -> bool:
    """True between August 1 and February 1, or whenever FORCE=true."""
    if forced():
        print("FORCE=true — skipping the season window check.")
        return True
    today = today or now()
    if today.month >= SEASON_START_MONTH:
        return True
    if today.month < SEASON_END_MONTH:
        return True
    return today.month == SEASON_END_MONTH and today.day <= SEASON_END_DAY


def is_reset_day(today: datetime | None = None) -> bool:
    """True only on August 1, or whenever FORCE=true."""
    if forced():
        print("FORCE=true — skipping the date check.")
        return True
    today = today or now()
    return today.month == RESET_MONTH and today.day == RESET_DAY


def last_completed_season(today: datetime | None = None) -> int:
    """The most recent NFL season that has finished.

    A season labelled Y runs from September Y to February Y+1, so on August 1 of
    year Y the season that has just wrapped up is Y-1 — the 2025 season ended in
    February 2026, and the 2026 season has not kicked off yet.

    Deliberately derived from the calendar rather than from NFL_SEASON. That
    variable is pinned in the workflow file and has to be bumped by hand every
    year; a job that quietly reloads the wrong season because nobody edited a
    YAML file is worse than one that works out the date for itself.
    """
    today = today or now()
    # Before August the current season is still in progress or in its playoffs,
    # so the last finished one is still the year before.
    return today.year - 1
