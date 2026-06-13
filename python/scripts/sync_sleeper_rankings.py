"""
Sleeper all-time rankings sync — run once at the start of each season.

For every league in the database, finds which Sleeper season IDs have not yet
been synced (stored in League.rankedSeasonIds), fetches only those seasons from
the Sleeper API, and incrementally updates SleeperRanking win/loss/tie totals.

On the first run the full previous_league_id chain is walked and fetched.
On every subsequent run only the new season is fetched — the stored chain
avoids redundant Sleeper API calls for seasons already processed.

Run manually via workflow_dispatch or automatically on September 1st.

Requires:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — Turso credentials
"""
from __future__ import annotations

import json
import os
import ssl
import time
import urllib.request
from datetime import datetime
from typing import Any

import certifi

ssl._create_default_https_context = lambda: ssl.create_default_context(
    cafile=certifi.where()
)

TURSO_DATABASE_URL: str = os.environ["TURSO_DATABASE_URL"]
TURSO_AUTH_TOKEN: str = os.environ["TURSO_AUTH_TOKEN"]
SLEEPER_BASE = "https://api.sleeper.app/v1"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def sleeper_get(path: str) -> Any:
    url = f"{SLEEPER_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "commissioner-suite/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
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
        with urllib.request.urlopen(req, timeout=20) as res:
            result = json.loads(res.read())
            for i, r in enumerate(result.get("results", [])):
                if r.get("type") == "error":
                    raise RuntimeError(f"Statement {i} failed: {r['error']}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Turso HTTP {e.code}: {body}") from e


def turso_query(sql: str, args: list[Any] | None = None) -> list[dict[str, Any]]:
    base_url = TURSO_DATABASE_URL.replace("libsql://", "https://")
    url = f"{base_url}/v2/pipeline"
    stmt: dict[str, Any] = {
        "sql": sql,
        "args": [{"type": "text", "value": str(a)} for a in (args or [])],
    }
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
    with urllib.request.urlopen(req, timeout=20) as res:
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


def new_cuid() -> str:
    import hashlib, random
    entropy = f"{time.time_ns()}{random.getrandbits(64)}"
    return "c" + hashlib.sha256(entropy.encode()).hexdigest()[:24]


# ── Chain discovery (Sleeper API calls only for unknown seasons) ───────────────

def find_unsynced_seasons(
    start_sleeper_id: str,
    known_ids: set[str],
) -> list[str]:
    """
    Walks the previous_league_id chain starting from `start_sleeper_id`,
    stopping as soon as a season ID already present in `known_ids` is
    encountered. Returns unsynced IDs oldest-first.

    Only calls the Sleeper API for seasons not yet in `known_ids`, so after
    the first full sync each annual run makes at most one or two API calls.
    """
    unsynced: list[str] = []
    current_id: str | None = start_sleeper_id

    while current_id:
        if current_id in known_ids:
            # Reached a season we've already processed — stop here.
            break

        league_meta = sleeper_get(f"/league/{current_id}")
        if not league_meta:
            print(f"    ⚠ Could not fetch league {current_id} — stopping chain walk.")
            break

        unsynced.append(current_id)
        current_id = league_meta.get("previous_league_id") or None

        if current_id and current_id not in known_ids:
            time.sleep(0.3)  # be courteous to Sleeper's API

    unsynced.reverse()
    return unsynced


# ── Per-season record fetcher ─────────────────────────────────────────────────

def fetch_season_records(
    season_id: str,
) -> dict[str, dict[str, Any]]:
    """
    Fetches rosters and users for one Sleeper season.
    Returns a dict keyed by sleeperUserId with wins/losses/ties and display info.
    """
    rosters = sleeper_get(f"/league/{season_id}/rosters")
    users   = sleeper_get(f"/league/{season_id}/users")

    if not rosters or not users:
        print(f"    ⚠ Missing rosters or users for {season_id} — skipping.")
        return {}

    user_map: dict[str, dict[str, Any]] = {u["user_id"]: u for u in users}
    records: dict[str, dict[str, Any]] = {}

    for roster in rosters:
        owner_id: str | None = roster.get("owner_id")
        if not owner_id:
            continue

        settings = roster.get("settings") or {}
        user = user_map.get(owner_id, {})

        records[owner_id] = {
            "displayName": user.get("display_name") or f"User {owner_id}",
            "teamName":    (user.get("metadata") or {}).get("team_name") or None,
            "wins":   int(settings.get("wins",   0) or 0),
            "losses": int(settings.get("losses", 0) or 0),
            "ties":   int(settings.get("ties",   0) or 0),
        }

    return records


# ── Upsert (incremental — adds delta on top of existing totals) ───────────────

def upsert_rankings_incremental(
    league_id: str,
    seasons_data: list[dict[str, dict[str, Any]]],
) -> int:
    """
    Merges win/loss/tie totals from `seasons_data` (one dict per season) into
    SleeperRanking. For users already in the table the delta is added to their
    existing totals; new users get a fresh row. Returns rows written.
    """
    # Aggregate all new seasons into a single delta per user.
    delta: dict[str, dict[str, Any]] = {}
    for season_records in seasons_data:
        for user_id, rec in season_records.items():
            if user_id not in delta:
                delta[user_id] = {
                    "displayName": rec["displayName"],
                    "teamName":    rec["teamName"],
                    "wins":   0,
                    "losses": 0,
                    "ties":   0,
                    "seasons": 0,
                }
            d = delta[user_id]
            d["wins"]   += rec["wins"]
            d["losses"] += rec["losses"]
            d["ties"]   += rec["ties"]
            d["seasons"] += 1
            d["displayName"] = rec["displayName"]  # keep most recent
            if rec["teamName"]:
                d["teamName"] = rec["teamName"]

    if not delta:
        return 0

    # Fetch existing rows so we can add the delta on top.
    existing_rows = turso_query(
        'SELECT sleeperUserId, totalWins, totalLosses, totalTies, seasonsPlayed '
        'FROM "SleeperRanking" WHERE leagueId = ?',
        [league_id],
    )
    existing: dict[str, dict[str, Any]] = {
        r["sleeperUserId"]: r for r in existing_rows
    }

    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    statements: list[dict[str, Any]] = []

    for user_id, d in delta.items():
        ex = existing.get(user_id)
        total_wins    = int(ex["totalWins"]     if ex else 0) + d["wins"]
        total_losses  = int(ex["totalLosses"]   if ex else 0) + d["losses"]
        total_ties    = int(ex["totalTies"]     if ex else 0) + d["ties"]
        seasons_played = int(ex["seasonsPlayed"] if ex else 0) + d["seasons"]
        denom = total_wins + total_losses + total_ties
        win_pct = round(total_wins / denom, 6) if denom > 0 else 0.5

        statements.append({
            "type": "execute",
            "stmt": {
                "sql": """
                    INSERT INTO "SleeperRanking"
                      ("id", "leagueId", "sleeperUserId", "displayName", "teamName",
                       "totalWins", "totalLosses", "totalTies", "winPct", "seasonsPlayed", "syncedAt")
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT("leagueId", "sleeperUserId") DO UPDATE SET
                      "displayName"    = excluded."displayName",
                      "teamName"       = excluded."teamName",
                      "totalWins"      = excluded."totalWins",
                      "totalLosses"    = excluded."totalLosses",
                      "totalTies"      = excluded."totalTies",
                      "winPct"         = excluded."winPct",
                      "seasonsPlayed"  = excluded."seasonsPlayed",
                      "syncedAt"       = excluded."syncedAt"
                """,
                "args": [
                    {"type": "text",    "value": new_cuid()},
                    {"type": "text",    "value": league_id},
                    {"type": "text",    "value": user_id},
                    {"type": "text",    "value": d["displayName"]},
                    {"type": "text",    "value": d["teamName"]} if d["teamName"] else {"type": "null", "value": None},
                    {"type": "integer", "value": total_wins},
                    {"type": "integer", "value": total_losses},
                    {"type": "integer", "value": total_ties},
                    {"type": "float",   "value": win_pct},
                    {"type": "integer", "value": seasons_played},
                    {"type": "text",    "value": now_iso},
                ],
            },
        })

    if statements:
        turso_execute(statements)

    return len(statements)


def save_synced_season_ids(league_id: str, all_synced_ids: list[str]) -> None:
    turso_execute([{
        "type": "execute",
        "stmt": {
            "sql": 'UPDATE "League" SET "rankedSeasonIds" = ? WHERE "id" = ?',
            "args": [
                {"type": "text", "value": json.dumps(all_synced_ids)},
                {"type": "text", "value": league_id},
            ],
        },
    }])


# ── Main ──────────────────────────────────────────────────────────────────────

def sync_league_rankings(league: dict[str, Any]) -> int:
    league_id         = league["id"]
    sleeper_league_id = league["sleeperLeagueId"]
    league_name       = league["name"] or sleeper_league_id

    known_ids: list[str] = json.loads(league.get("rankedSeasonIds") or "[]")
    known_set = set(known_ids)

    print(f"  Already synced: {len(known_ids)} season(s).")
    unsynced = find_unsynced_seasons(sleeper_league_id, known_set)

    if not unsynced:
        print("  Nothing new to sync.")
        return 0

    print(f"  Fetching {len(unsynced)} new season(s): {unsynced}")
    seasons_data: list[dict[str, dict[str, Any]]] = []
    for i, sid in enumerate(unsynced, 1):
        print(f"    {i}/{len(unsynced)}: {sid}")
        records = fetch_season_records(sid)
        if records:
            seasons_data.append(records)
        if i < len(unsynced):
            time.sleep(0.3)

    written = upsert_rankings_incremental(league_id, seasons_data)
    print(f"  ✓ Updated {written} ranking row(s).")

    # Persist the expanded list of synced season IDs.
    save_synced_season_ids(league_id, known_ids + unsynced)
    return written


def main() -> None:
    print("Syncing all-time Sleeper rankings...")

    leagues = turso_query(
        'SELECT id, sleeperLeagueId, name, rankedSeasonIds FROM "League"'
    )
    if not leagues:
        print("No leagues found in Turso — sync leagues via the commissioner dashboard first.")
        return

    print(f"Found {len(leagues)} league(s).\n")
    total = 0

    for league in leagues:
        print(f"League: {league.get('name') or league['sleeperLeagueId']}")
        try:
            total += sync_league_rankings(league)
        except Exception as e:
            print(f"  ✗ Error: {e}")
        print()

    print(f"✓ Rankings sync complete. {total} row(s) upserted across {len(leagues)} league(s).")


if __name__ == "__main__":
    main()
