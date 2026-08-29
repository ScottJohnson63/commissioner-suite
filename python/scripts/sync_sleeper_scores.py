"""Sleeper score sync — Tuesdays at 08:30 UTC, in season only.

Copies each team's fantasy points for the last completed week from Sleeper onto
the Matchup rows of the locally generated schedule. Runs after the NFL stat sync
so both feeds land in the same window.

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
  NFL_SEASON                           — season to sync
  FORCE                                — "true" bypasses the season window
  WEEK                                 — override the week to sync
"""
from __future__ import annotations

import os

from common import season, sleeper, syncrun, turso

UPDATE_POINTS_SQL = 'UPDATE "Matchup" SET "homePoints" = ?, "awayPoints" = ? WHERE "id" = ?'

MATCHUPS_FOR_WEEK_SQL = """
    SELECT m.id,
           ht.sleeperRosterId AS homeRosterId,
           at.sleeperRosterId AS awayRosterId
    FROM   Matchup m
    JOIN   Schedule s  ON s.id = m.scheduleId
    JOIN   Team     ht ON ht.id = m.homeTeamId
    JOIN   Team     at ON at.id = m.awayTeamId
    WHERE  s.leagueId = ?
    AND    m.week     = ?
"""


def target_week() -> int:
    """The week to sync — the WEEK override if set, else the last completed one."""
    override = os.environ.get("WEEK")
    if override:
        print(f"WEEK override: using week {override}")
        return int(override)
    return sleeper.last_completed_week()


def sync_league_scores(league_id: str, sleeper_league_id: str, name: str, week: int) -> int:
    """Writes points onto one league's matchup rows. Returns rows updated."""
    print(f"  Fetching Sleeper matchups for {name} (week {week})...")
    sleeper_matchups = sleeper.get(f"/league/{sleeper_league_id}/matchups/{week}")

    if not sleeper_matchups:
        print(f"  No Sleeper matchup data for week {week} — skipping.")
        return 0

    roster_points: dict[str, float] = {
        str(m["roster_id"]): float(m.get("points", 0) or 0) for m in sleeper_matchups
    }
    print(f"  Got points for {len(roster_points)} rosters.")

    matchup_rows = turso.query(MATCHUPS_FOR_WEEK_SQL, [league_id, week])
    if not matchup_rows:
        print(f"  No Matchup rows for week {week} — schedule may not be generated yet.")
        return 0

    updates = []
    for row in matchup_rows:
        home = roster_points.get(str(row["homeRosterId"]))
        away = roster_points.get(str(row["awayRosterId"]))
        if home is None and away is None:
            print(f"    ⚠ No points for matchup {row['id']} — roster IDs may not match.")
            continue
        updates.append([home or 0.0, away or 0.0, row["id"]])

    turso.execute([turso.statement(UPDATE_POINTS_SQL, u) for u in updates])
    print(f"  ✓ Updated {len(updates)}/{len(matchup_rows)} matchup rows.")
    return len(updates)


def main() -> None:
    with syncrun.record(syncrun.SLEEPER_SCORES) as run:
        if not season.is_in_season():
            reason = f"Outside the NFL season window ({season.now():%B %d})."
            print(f"{reason} Set FORCE=true to override.")
            run.skip(reason)
            return

        current = season.current_season()
        week = target_week()
        print(f"Syncing Sleeper scores for season {current}, week {week}...")

        # LEAGUE_ID narrows a commissioner's manual run to the league selected
        # on the Data Sync page; blank (the scheduled case) sweeps them all.
        only = syncrun.target_league()
        if only:
            leagues = turso.query(
                'SELECT id, sleeperLeagueId, name FROM "League" '
                "WHERE season = ? AND sleeperLeagueId = ?",
                [current, only],
            )
        else:
            leagues = turso.query(
                'SELECT id, sleeperLeagueId, name FROM "League" WHERE season = ?', [current]
            )

        if not leagues:
            reason = (
                f"League {only} is not registered for season {current}."
                if only
                else "No leagues in the database — add one from the Data Sync page first."
            )
            print(reason)
            run.skip(reason)
            return

        print(f"Found {len(leagues)} league(s).\n")
        failures: list[str] = []

        for league in leagues:
            name = league["name"] or league["sleeperLeagueId"]
            print(f"League: {name} ({league['sleeperLeagueId']})")
            try:
                run.count(
                    sync_league_scores(league["id"], league["sleeperLeagueId"], name, week)
                )
            except Exception as e:
                # One bad league should not stop the rest, but the run should
                # still surface as failed in the dashboard.
                print(f"  ✗ Error syncing {name}: {e}")
                failures.append(f"{name}: {e}")
            print()

        run.note(season=current, week=week, leagues=len(leagues))
        if failures:
            run.note(failures=failures)
            raise RuntimeError(f"{len(failures)} of {len(leagues)} league(s) failed")

        print(f"✓ Score sync complete. {run.row_count} matchup rows updated.")


if __name__ == "__main__":
    main()
