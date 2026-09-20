"""Dropping the app's cached answers when a sync invalidates one.

The Next.js app caches a few facts that cost a whole-table scan to derive in
`SleeperCache` rows — see nextjs/src/lib/dbCache.ts. It has no way to notice a
sync: NflWeeklyStat is written only by the scripts in this directory, never by
the app, so there is no write on that side to hook. Until now the age limit was
the whole mechanism, which meant a season's first stats stayed invisible to the
Statistics tab for up to a day after they landed.

These scripts are the write the app cannot see, so they are the right place to
evict. Deleting the row rather than rewriting it means the next reader measures
and only if there is one — the same contract DbCache.invalidate() has.

A failed eviction is never a failed sync. The rows are already written by the
time this runs, the age limit still expires the cache on its own, and a job
reported as failed over a cache delete would send somebody looking for missing
stats that are in fact all there.
"""
from __future__ import annotations

from common import turso

# Key of the cached season list. Must match STAT_SEASONS_CACHE_KEY in
# nextjs/src/lib/nflSeasons.ts.
STAT_SEASONS_KEY = "nfl_stat_seasons"


def drop_stat_seasons() -> None:
    """Evicts the cached "which seasons does the stat table hold" answer."""
    try:
        turso.execute_one('DELETE FROM "SleeperCache" WHERE key = ?', [STAT_SEASONS_KEY])
        print(f"  Dropped the {STAT_SEASONS_KEY} cache row.")
    except Exception as exc:  # noqa: BLE001 - see the note above on why this is swallowed
        print(f"  ⚠ Could not drop the {STAT_SEASONS_KEY} cache row ({exc}).")
