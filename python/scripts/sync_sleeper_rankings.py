"""Sleeper all-time rankings sync — September 1st, before divisions are set.

For every league, walks the Sleeper previous_league_id chain to find seasons not
yet recorded in League.rankedSeasonIds, then folds their win/loss/tie totals into
SleeperRanking. The stored chain is what keeps this cheap: the first run fetches
every historical season, and each later run fetches only the season that ended.

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
"""
from __future__ import annotations

import json
from typing import Any

from common import season, sleeper, syncrun, turso

UPSERT_RANKING_SQL = """
    INSERT INTO "SleeperRanking"
      ("id", "leagueId", "sleeperUserId", "displayName", "teamName",
       "totalWins", "totalLosses", "totalTies", "winPct", "seasonsPlayed", "syncedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("leagueId", "sleeperUserId") DO UPDATE SET
      "displayName"   = excluded."displayName",
      "teamName"      = excluded."teamName",
      "totalWins"     = excluded."totalWins",
      "totalLosses"   = excluded."totalLosses",
      "totalTies"     = excluded."totalTies",
      "winPct"        = excluded."winPct",
      "seasonsPlayed" = excluded."seasonsPlayed",
      "syncedAt"      = excluded."syncedAt"
"""

# Win percentage for a manager with no completed games. 0.5 keeps them mid-table
# rather than bottom, since 0 wins from 0 games is not a losing record.
NO_GAMES_WIN_PCT = 0.5


def find_unsynced_seasons(start_sleeper_id: str, known_ids: set[str]) -> list[str]:
    """Walks the previous_league_id chain, stopping at the first known season.

    Returns the unsynced Sleeper league IDs oldest-first.
    """
    unsynced: list[str] = []
    current_id: str | None = start_sleeper_id

    while current_id and current_id not in known_ids:
        league_meta = sleeper.get(f"/league/{current_id}")
        if not league_meta:
            print(f"    ⚠ Could not fetch league {current_id} — stopping chain walk.")
            break
        unsynced.append(current_id)
        current_id = league_meta.get("previous_league_id") or None

    unsynced.reverse()
    return unsynced


def fetch_season_records(season_id: str) -> dict[str, dict[str, Any]]:
    """Returns one season's per-manager record, keyed by Sleeper user ID."""
    rosters = sleeper.get(f"/league/{season_id}/rosters")
    users = sleeper.get(f"/league/{season_id}/users")

    if not rosters or not users:
        print(f"    ⚠ Missing rosters or users for {season_id} — skipping.")
        return {}

    user_map = {u["user_id"]: u for u in users}
    records: dict[str, dict[str, Any]] = {}

    for roster in rosters:
        owner_id = roster.get("owner_id")
        if not owner_id:
            continue
        settings = roster.get("settings") or {}
        user = user_map.get(owner_id, {})
        records[owner_id] = {
            "displayName": user.get("display_name") or f"User {owner_id}",
            "teamName": (user.get("metadata") or {}).get("team_name") or None,
            "wins": int(settings.get("wins", 0) or 0),
            "losses": int(settings.get("losses", 0) or 0),
            "ties": int(settings.get("ties", 0) or 0),
        }

    return records


def merge_seasons(seasons_data: list[dict[str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Collapses several seasons of records into one delta per manager."""
    delta: dict[str, dict[str, Any]] = {}
    for records in seasons_data:
        for user_id, rec in records.items():
            d = delta.setdefault(
                user_id,
                {"displayName": rec["displayName"], "teamName": rec["teamName"],
                 "wins": 0, "losses": 0, "ties": 0, "seasons": 0},
            )
            d["wins"] += rec["wins"]
            d["losses"] += rec["losses"]
            d["ties"] += rec["ties"]
            d["seasons"] += 1
            # Seasons arrive oldest-first, so the last write wins — the manager's
            # most recent display name and team name.
            d["displayName"] = rec["displayName"]
            if rec["teamName"]:
                d["teamName"] = rec["teamName"]
    return delta


def upsert_rankings(league_id: str, seasons_data: list[dict[str, dict[str, Any]]]) -> int:
    """Adds the new seasons on top of each manager's existing totals."""
    delta = merge_seasons(seasons_data)
    if not delta:
        return 0

    existing = {
        r["sleeperUserId"]: r
        for r in turso.query(
            'SELECT sleeperUserId, totalWins, totalLosses, totalTies, seasonsPlayed '
            'FROM "SleeperRanking" WHERE leagueId = ?',
            [league_id],
        )
    }

    synced_at = syncrun.timestamp()
    rows = []

    for user_id, d in delta.items():
        prior = existing.get(user_id)
        wins = int(prior["totalWins"] if prior else 0) + d["wins"]
        losses = int(prior["totalLosses"] if prior else 0) + d["losses"]
        ties = int(prior["totalTies"] if prior else 0) + d["ties"]
        seasons_played = int(prior["seasonsPlayed"] if prior else 0) + d["seasons"]

        played = wins + losses + ties
        win_pct = round(wins / played, 6) if played else NO_GAMES_WIN_PCT

        rows.append([
            syncrun.new_id(), league_id, user_id, d["displayName"], d["teamName"],
            wins, losses, ties, win_pct, seasons_played, synced_at,
        ])

    turso.execute([turso.statement(UPSERT_RANKING_SQL, r) for r in rows])
    return len(rows)


def save_synced_season_ids(league_id: str, all_synced_ids: list[str]) -> None:
    turso.execute_one(
        'UPDATE "League" SET "rankedSeasonIds" = ? WHERE "id" = ?',
        [json.dumps(all_synced_ids), league_id],
    )


def sync_league_rankings(league: dict[str, Any]) -> int:
    known_ids: list[str] = json.loads(league.get("rankedSeasonIds") or "[]")

    print(f"  Already synced: {len(known_ids)} season(s).")
    unsynced = find_unsynced_seasons(league["sleeperLeagueId"], set(known_ids))

    if not unsynced:
        print("  Nothing new to sync.")
        return 0

    print(f"  Fetching {len(unsynced)} new season(s): {unsynced}")
    seasons_data = []
    for i, sid in enumerate(unsynced, 1):
        print(f"    {i}/{len(unsynced)}: {sid}")
        records = fetch_season_records(sid)
        if records:
            seasons_data.append(records)

    written = upsert_rankings(league["id"], seasons_data)
    print(f"  ✓ Updated {written} ranking row(s).")

    save_synced_season_ids(league["id"], known_ids + unsynced)
    return written


def main() -> None:
    with syncrun.record(syncrun.SLEEPER_RANKINGS) as run:
        print("Syncing all-time Sleeper rankings...")

        # LEAGUE_ID narrows a commissioner's manual run to the league selected
        # on the Data Sync page; blank (the scheduled case) sweeps them all.
        only = syncrun.target_league()
        if only:
            leagues = turso.query(
                'SELECT id, sleeperLeagueId, name, rankedSeasonIds FROM "League" '
                "WHERE sleeperLeagueId = ?",
                [only],
            )
        else:
            leagues = turso.query(
                'SELECT id, sleeperLeagueId, name, rankedSeasonIds FROM "League"'
            )

        if not leagues:
            reason = (
                f"League {only} is not registered."
                if only
                else "No leagues in the database — add one from the Data Sync page first."
            )
            print(reason)
            run.skip(reason)
            return

        print(f"Found {len(leagues)} league(s).\n")
        failures: list[str] = []

        for league in leagues:
            name = league.get("name") or league["sleeperLeagueId"]
            print(f"League: {name}")
            try:
                run.count(sync_league_rankings(league))
            except Exception as e:
                # One bad league should not stop the rest, but the run should
                # still surface as failed in the dashboard.
                print(f"  ✗ Error: {e}")
                failures.append(f"{name}: {e}")
            print()

        run.note(leagues=len(leagues), season=season.current_season())
        if failures:
            run.note(failures=failures)
            raise RuntimeError(f"{len(failures)} of {len(leagues)} league(s) failed")

        print(f"✓ Rankings sync complete. {run.row_count} row(s) upserted.")


if __name__ == "__main__":
    main()
