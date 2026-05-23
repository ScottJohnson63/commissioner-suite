"""
Season reset script — runs once on August 1st.
Truncates NflWeeklyStat and reloads the last 3 seasons of data.
Can also be triggered manually via workflow_dispatch.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.request
from datetime import datetime
from typing import Any

import certifi
import nflreadpy as nfl
import polars as pl

# ── SSL fix ───────────────────────────────────────────────────────────────────
ssl._create_default_https_context = lambda: ssl.create_default_context(
    cafile=certifi.where()
)

TURSO_DATABASE_URL: str = os.environ["TURSO_DATABASE_URL"]
TURSO_AUTH_TOKEN: str = os.environ["TURSO_AUTH_TOKEN"]
CURRENT_SEASON: int = int(os.environ.get("NFL_SEASON", str(datetime.now().year)))
SEASONS_TO_LOAD: int = 3
FORCE: bool = os.environ.get("FORCE", "false").lower() == "true"

COLUMN_MAP: dict[str, str] = {
    "player_id": "playerId",
    "player_name": "playerName",
    "player_display_name": "playerDisplayName",
    "position": "position",
    "position_group": "positionGroup",
    "headshot_url": "headshot",
    "season": "season",
    "week": "week",
    "season_type": "seasonType",
    "team": "team",
    "opponent_team": "opponentTeam",
    "completions": "completions",
    "attempts": "attempts",
    "passing_yards": "passingYards",
    "passing_tds": "passingTds",
    "passing_interceptions": "passingInterceptions",
    "sacks_suffered": "sacksSuffered",
    "sack_yards_lost": "sackYardsLost",
    "sack_fumbles": "sackFumbles",
    "sack_fumbles_lost": "sackFumblesLost",
    "passing_air_yards": "passingAirYards",
    "passing_yards_after_catch": "passingYardsAfterCatch",
    "passing_first_downs": "passingFirstDowns",
    "passing_epa": "passingEpa",
    "passing_cpoe": "passingCpoe",
    "passing_2pt_conversions": "passing2ptConversions",
    "pacr": "pacr",
    "carries": "carries",
    "rushing_yards": "rushingYards",
    "rushing_tds": "rushingTds",
    "rushing_fumbles": "rushingFumbles",
    "rushing_fumbles_lost": "rushingFumblesLost",
    "rushing_first_downs": "rushingFirstDowns",
    "rushing_epa": "rushingEpa",
    "rushing_2pt_conversions": "rushing2ptConversions",
    "receptions": "receptions",
    "targets": "targets",
    "receiving_yards": "receivingYards",
    "receiving_tds": "receivingTds",
    "receiving_fumbles": "receivingFumbles",
    "receiving_fumbles_lost": "receivingFumblesLost",
    "receiving_air_yards": "receivingAirYards",
    "receiving_yards_after_catch": "receivingYardsAfterCatch",
    "receiving_first_downs": "receivingFirstDowns",
    "receiving_epa": "receivingEpa",
    "receiving_2pt_conversions": "receiving2ptConversions",
    "racr": "racr",
    "target_share": "targetShare",
    "air_yards_share": "airYardsShare",
    "wopr": "wopr",
    "special_teams_tds": "specialTeamsTds",
    "def_tackles_solo": "defTacklesSolo",
    "def_tackles_with_assist": "defTacklesWithAssist",
    "def_tackle_assists": "defTackleAssists",
    "def_tackles_for_loss": "defTacklesForLoss",
    "def_tackles_for_loss_yards": "defTacklesForLossYards",
    "def_fumbles_forced": "defFumblesForced",
    "def_sacks": "defSacks",
    "def_sack_yards": "defSackYards",
    "def_qb_hits": "defQbHits",
    "def_interceptions": "defInterceptions",
    "def_interception_yards": "defInterceptionYards",
    "def_pass_defended": "defPassDefended",
    "def_tds": "defTds",
    "def_fumbles": "defFumbles",
    "def_safeties": "defSafeties",
    "misc_yards": "miscYards",
    "fumble_recovery_own": "fumbleRecoveryOwn",
    "fumble_recovery_yards_own": "fumbleRecoveryYardsOwn",
    "fumble_recovery_opp": "fumbleRecoveryOpp",
    "fumble_recovery_yards_opp": "fumbleRecoveryYardsOpp",
    "fumble_recovery_tds": "fumbleRecoveryTds",
    "penalties": "penalties",
    "penalty_yards": "penaltyYards",
    "punt_returns": "puntReturns",
    "punt_return_yards": "puntReturnYards",
    "kickoff_returns": "kickoffReturns",
    "kickoff_return_yards": "kickoffReturnYards",
    "fg_made": "fgMade",
    "fg_att": "fgAtt",
    "fg_missed": "fgMissed",
    "fg_blocked": "fgBlocked",
    "fg_long": "fgLong",
    "fg_pct": "fgPct",
    "fg_made_0_19": "fgMade0To19",
    "fg_made_20_29": "fgMade20To29",
    "fg_made_30_39": "fgMade30To39",
    "fg_made_40_49": "fgMade40To49",
    "fg_made_50_59": "fgMade50To59",
    "fg_made_60_": "fgMade60Plus",
    "fg_missed_0_19": "fgMissed0To19",
    "fg_missed_20_29": "fgMissed20To29",
    "fg_missed_30_39": "fgMissed30To39",
    "fg_missed_40_49": "fgMissed40To49",
    "fg_missed_50_59": "fgMissed50To59",
    "fg_missed_60_": "fgMissed60Plus",
    "fg_made_distance": "fgMadeDistance",
    "fg_missed_distance": "fgMissedDistance",
    "fg_blocked_distance": "fgBlockedDistance",
    "pat_made": "patMade",
    "pat_att": "patAtt",
    "pat_missed": "patMissed",
    "pat_blocked": "patBlocked",
    "pat_pct": "patPct",
    "gwfg_made": "gwfgMade",
    "gwfg_att": "gwfgAtt",
    "gwfg_missed": "gwfgMissed",
    "gwfg_blocked": "gwfgBlocked",
    "gwfg_distance": "gwfgDistance",
    "fantasy_points": "fantasyPoints",
    "fantasy_points_ppr": "fantasyPointsPpr",
}

SKIP_COLUMNS: set[str] = {"fg_made_list", "fg_missed_list", "fg_blocked_list"}


def is_reset_day() -> bool:
    """Only run on August 1st unless FORCE=true."""
    if FORCE:
        print("FORCE=true, skipping date check.")
        return True
    today = datetime.utcnow()
    return today.month == 8 and today.day == 1


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
        with urllib.request.urlopen(req) as res:
            result = json.loads(res.read())
            for i, r in enumerate(result.get("results", [])):
                if r.get("type") == "error":
                    raise RuntimeError(f"Statement {i} failed: {r['error']}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP {e.code}: {body}") from e


def polars_value_to_arg(val: Any) -> dict[str, Any]:
    if val is None:
        return {"type": "null", "value": None}
    if isinstance(val, bool):
        return {"type": "integer", "value": int(val)}
    if isinstance(val, int):
        return {"type": "integer", "value": val}
    if isinstance(val, float):
        return {"type": "float", "value": val}
    return {"type": "text", "value": str(val)}


def truncate_table() -> None:
    print("Truncating NflWeeklyStat...")
    turso_execute([{"type": "execute", "stmt": {"sql": 'DELETE FROM "NflWeeklyStat"', "args": []}}])
    print("  Table cleared.")


def fetch_stats(seasons: list[int]) -> pl.DataFrame:
    print(f"Fetching stats for seasons: {seasons}...")
    df = nfl.load_player_stats(seasons)

    available_skip = [c for c in SKIP_COLUMNS if c in df.columns]
    df = df.drop(available_skip)

    available = [c for c in COLUMN_MAP if c in df.columns]
    df = df.select(available).rename({k: COLUMN_MAP[k] for k in available})
    df = df.filter(pl.col("playerId").is_not_null())

    df = df.with_columns([
        pl.col(c).cast(pl.Float64, strict=False)
        for c in df.columns
        if c not in ("playerId", "playerName", "playerDisplayName", "position",
                     "positionGroup", "headshot", "seasonType", "team", "opponentTeam")
        and df[c].dtype != pl.Utf8
    ])

    print(f"  {len(df)} rows, {len(df.columns)} columns")
    return df


def upsert_rows(df: pl.DataFrame) -> None:
    cols = df.columns
    col_names = ", ".join([f'"{c}"' for c in cols])
    placeholders = ", ".join(["?" for _ in cols])
    updates = ", ".join([
        f'"{c}" = excluded."{c}"'
        for c in cols
        if c not in ("season", "week", "playerId")
    ])

    sql = f"""
        INSERT INTO NflWeeklyStat (id, {col_names})
        VALUES (lower(hex(randomblob(16))), {placeholders})
        ON CONFLICT (season, week, "playerId")
        DO UPDATE SET {updates}
    """.strip()

    rows = df.to_dicts()
    chunk_size = 100
    total = 0

    for i in range(0, len(rows), chunk_size):
        chunk = rows[i: i + chunk_size]
        statements = [
            {
                "type": "execute",
                "stmt": {
                    "sql": sql,
                    "args": [polars_value_to_arg(row[c]) for c in cols],
                },
            }
            for row in chunk
        ]
        turso_execute(statements)
        total += len(chunk)
        if total % 500 == 0 or total == len(rows):
            print(f"  Upserted {total}/{len(rows)} rows")


def main() -> None:
    if not is_reset_day():
        print(f"Today is not August 1st — skipping reset. Set FORCE=true to override.")
        return

    seasons = list(range(CURRENT_SEASON - SEASONS_TO_LOAD + 1, CURRENT_SEASON + 1))
    truncate_table()
    df = fetch_stats(seasons)
    print("Syncing to Turso...")
    upsert_rows(df)
    print("✓ Season reset complete.")


if __name__ == "__main__":
    main()