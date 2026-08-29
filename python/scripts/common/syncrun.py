"""Records each scheduled sync as a SyncRun row.

The Data Sync dashboard tab reads the newest row per source to show when a feed
last updated and whether it succeeded, so every job must leave a row behind —
including the ones that exit early because they are out of season.
"""
from __future__ import annotations

import json
import os
import secrets
import traceback
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

from common import season, turso

# Must match the SyncSource enum in nextjs/prisma/schema.prisma.
NFL_WEEKLY = "NFL_WEEKLY"
NFL_SEASON_RESET = "NFL_SEASON_RESET"
SLEEPER_SCORES = "SLEEPER_SCORES"
SLEEPER_RANKINGS = "SLEEPER_RANKINGS"

# Prisma stores SQLite DATETIME values in this format.
_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def timestamp() -> str:
    """Current UTC time in the format Prisma expects for a SQLite DATETIME."""
    return season.now().strftime(_DATETIME_FORMAT)


def new_id() -> str:
    """A random 25-char id in the same shape as Prisma's cuid()."""
    return "c" + secrets.token_hex(12)


def target_league() -> str | None:
    """The single Sleeper league this run is aimed at, if any.

    Set by the LEAGUE_ID workflow input when a commissioner syncs from the Data
    Sync page. Blank (the scheduled case) means sweep every league, which is
    recorded as a NULL leagueId.
    """
    return os.environ.get("LEAGUE_ID", "").strip() or None


class Run:
    """Handle for the in-flight sync, used to report what the job did."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.row_count = 0
        self.detail: dict[str, Any] = {}
        self.skipped_reason: str | None = None

    def count(self, n: int) -> None:
        self.row_count += n

    def note(self, **fields: Any) -> None:
        self.detail.update(fields)

    def skip(self, reason: str) -> None:
        """Marks this run as intentionally doing nothing."""
        self.skipped_reason = reason


def _write(
    run_id: str,
    source: str,
    status: str,
    started_at: str,
    row_count: int,
    detail: dict[str, Any],
    finished: bool,
) -> None:
    turso.execute_one(
        'INSERT INTO "SyncRun" '
        '("id", "source", "status", "trigger", "leagueId", "rowCount", "detail", '
        '"startedAt", "finishedAt") '
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
        'ON CONFLICT("id") DO UPDATE SET '
        '"status" = excluded."status", "rowCount" = excluded."rowCount", '
        '"detail" = excluded."detail", "finishedAt" = excluded."finishedAt"',
        [
            run_id,
            source,
            status,
            season.trigger(),
            target_league(),
            row_count,
            json.dumps(detail),
            started_at,
            timestamp() if finished else None,
        ],
    )


@contextmanager
def record(source: str) -> Iterator[Run]:
    """Wraps a sync job so its outcome always lands in SyncRun.

    Writes a RUNNING row up front so a job that is killed mid-run (GitHub Actions
    timeout, runner eviction) still leaves a trace instead of looking like it
    never happened.
    """
    run = Run(source)
    run_id = new_id()
    started_at = timestamp()

    try:
        _write(run_id, source, "RUNNING", started_at, 0, {}, finished=False)
    except Exception as e:
        # Never let bookkeeping stop the actual sync.
        print(f"⚠ Could not record sync start: {e}")

    try:
        yield run
    except Exception as e:
        detail = {**run.detail, "error": str(e), "traceback": traceback.format_exc()[-2000:]}
        try:
            _write(run_id, source, "FAILED", started_at, run.row_count, detail, finished=True)
        except Exception as write_error:
            print(f"⚠ Could not record sync failure: {write_error}")
        raise

    status = "SKIPPED" if run.skipped_reason else "SUCCESS"
    detail = dict(run.detail)
    if run.skipped_reason:
        detail["reason"] = run.skipped_reason

    try:
        _write(run_id, source, status, started_at, run.row_count, detail, finished=True)
    except Exception as e:
        print(f"⚠ Could not record sync completion: {e}")
