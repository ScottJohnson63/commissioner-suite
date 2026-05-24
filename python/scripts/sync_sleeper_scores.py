"""
Sleeper score sync — runs every Tuesday after sync_nfl_weekly.
Fetches fantasy points from Sleeper for the most recently completed
week and updates homePoints / awayPoints on Matchup rows in Turso.

Requires:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — Turso credentials
  NFL_SEASON — current season year (e.g. 2025)
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.request
from datetime import datetime
from typing import Any

import certifi

ssl._create_default_https_context = lambda: ssl.create_default_context(
    cafile=certifi.where()
)

TURSO_DATABASE_URL: str = os.environ["TURSO_DATABASE_URL"]
TURSO_AUTH_TOKEN: str = os.environ["TURSO_AUTH_TOKEN"]
CURRENT_SEASON: int = int(os.environ.get("NFL_SEASON", str(datetime.now().year)))
FORCE: bool = os.environ.get("FORCE", "false").lower() == "true"
# Override week for manual runs: WEEK=5 python sync_sleeper_scores.py
FORCE_WEEK: int | None = int(os.environ["WEEK"]) if os.environ.get("WEEK") else None

SLEEPER_BASE = "https://api.sleeper.app/v1"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def sleeper_get(path: str) -> Any:
    url = f"{SLEEPER_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "commissioner-suite/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Sleeper HTTP {e.code} for {path}") from e


def turso_execute(statements: list[dict[str, Any]]) -> None:
    base_url = TURSO_DATABASE_URL.replace("libsql://", "https://")
    url = f"{base_url}/v2/pipeline"
    payload = json.dumps({"requests": statements}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            result = json.loads(res.read())
            for i, r in enumerate(result.get("results", [])):
                if r.get("type") == "error":
                    raise RuntimeError(f"Statement {i} failed: {r['error']}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Turso HTTP {e.code}: {body}") from e


def turso_query(sql: str, args: list[Any] | None = None) -> list[dict[str, Any]]:
    """Run a SELECT and return rows as list of dicts."""
    base_url = TURSO_DATABASE_URL.replace("libsql://", "https://")
    url = f"{base_url}/v2/pipeline"
    stmt: dict[str, Any] = {"sql": sql, "args": [{"type": "text", "value": str(a)} for a in (args or [])]}
    payload = json.dumps({"requests": [{"type": "execute", "stmt": stmt}]}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        result = json.loads(res.read())

    result_set = result["results"][0]
    if result_set.get("type") == "error":
        raise RuntimeError(f"Query error: {result_set['error']}")

    rows_data = result_set["response"]["result"]
    cols = [c["name"] for c in rows_data["cols"]]
    return [
        {cols[i]: (cell["value"] if cell["type"] != "null" else None) for i, cell in enumerate(row)}
        for row in rows_data["rows"]
    ]


# ── Season window guard ───────────────────────────────────────────────────────

def is_in_season() -> bool:
    if FORCE:
        print("FORCE=true — skipping season window check.")
        return True
    today = datetime.utcnow()
    if today.month >= 8:
        return True
    if today.month == 1 or (today.month == 2 and today.day == 1):
        return True
    return False


# ── Sleeper data fetchers ─────────────────────────────────────────────────────

def get_current_week() -> int:
    """Returns the most recently COMPLETED week (state.week - 1 during season)."""
    if FORCE_WEEK:
        print(f"WEEK override: using week {FORCE_WEEK}")
        return FORCE_WEEK
    state = sleeper_get("/state/nfl")
    # During the season, state.week is the current week in progress.
    # We want the last completed week.
    week = state.get("week", 1)
    season_type = state.get("season_type", "off")
    if season_type == "regular":
        return max(1, week - 1)
    # Post-season or off-season — return last regular season week
    return 18


def fetch_sleeper_matchups(sleeper_league_id: str, week: int) -> list[dict[str, Any]]:
    """
    Returns Sleeper matchup objects for the given week.
    Each object has: roster_id, matchup_id, points
    """
    return sleeper_get(f"/league/{sleeper_league_id}/matchups/{week}")


# ── Core sync logic ───────────────────────────────────────────────────────────

def sync_league_scores(
    league_id: str,
    sleeper_league_id: str,
    league_name: str,
    week: int,
) -> int:
    """
    Syncs scores for one league for the given week.
    Returns the number of matchup rows updated.
    """
    print(f"  Fetching Sleeper matchups for {league_name} (week {week})...")
    sleeper_matchups = fetch_sleeper_matchups(sleeper_league_id, week)

    if not sleeper_matchups:
        print(f"  No Sleeper matchup data for week {week} — skipping.")
        return 0

    # Build map: roster_id (str) → points
    roster_points: dict[str, float] = {
        str(m["roster_id"]): float(m.get("points", 0) or 0)
        for m in sleeper_matchups
    }
    print(f"  Got points for {len(roster_points)} rosters.")

    # Fetch Matchup rows from Turso for this league + week
    # Join through Schedule to filter by leagueId
    matchup_rows = turso_query(
        """
        SELECT m.id, m.homeTeamId, m.awayTeamId,
               ht.sleeperRosterId AS homeRosterId,
               at.sleeperRosterId AS awayRosterId
        FROM   Matchup m
        JOIN   Schedule s  ON s.id = m.scheduleId
        JOIN   Team     ht ON ht.id = m.homeTeamId
        JOIN   Team     at ON at.id = m.awayTeamId
        WHERE  s.leagueId = ?
        AND    m.week     = ?
        """,
        [league_id, str(week)],
    )

    if not matchup_rows:
        print(f"  No Matchup rows found in Turso for week {week} — schedule may not be generated yet.")
        return 0

    # Build UPDATE statements
    statements: list[dict[str, Any]] = []
    updated = 0

    for row in matchup_rows:
        home_pts = roster_points.get(str(row["homeRosterId"]))
        away_pts = roster_points.get(str(row["awayRosterId"]))

        if home_pts is None and away_pts is None:
            print(f"    ⚠ No points found for matchup {row['id']} — roster IDs may not match.")
            continue

        statements.append({
            "type": "execute",
            "stmt": {
                "sql": 'UPDATE "Matchup" SET "homePoints" = ?, "awayPoints" = ? WHERE "id" = ?',
                "args": [
                    {"type": "float", "value": home_pts or 0.0},
                    {"type": "float", "value": away_pts or 0.0},
                    {"type": "text",  "value": row["id"]},
                ],
            },
        })
        updated += 1

    if statements:
        turso_execute(statements)

    print(f"  ✓ Updated {updated}/{len(matchup_rows)} matchup rows.")
    return updated


def main() -> None:
    if not is_in_season():
        today = datetime.utcnow()
        print(f"Outside NFL season window ({today.strftime('%B %d')}) — skipping. Set FORCE=true to override.")
        return

    week = get_current_week()
    print(f"Syncing Sleeper scores for season {CURRENT_SEASON}, week {week}...")

    # Fetch all leagues from Turso
    leagues = turso_query(
        'SELECT id, sleeperLeagueId, name FROM "League" WHERE season = ?',
        [str(CURRENT_SEASON)],
    )

    if not leagues:
        print("No leagues found in Turso — sync leagues via the commissioner dashboard first.")
        return

    print(f"Found {len(leagues)} league(s).\n")
    total_updated = 0

    for league in leagues:
        league_id = league["id"]
        sleeper_league_id = league["sleeperLeagueId"]
        league_name = league["name"] or sleeper_league_id

        print(f"League: {league_name} ({sleeper_league_id})")
        try:
            updated = sync_league_scores(league_id, sleeper_league_id, league_name, week)
            total_updated += updated
        except Exception as e:
            # Non-fatal — log and continue with next league
            print(f"  ✗ Error syncing {league_name}: {e}")

        print()

    print(f"✓ Sleeper score sync complete. {total_updated} matchup rows updated across {len(leagues)} league(s).")


if __name__ == "__main__":
    main()