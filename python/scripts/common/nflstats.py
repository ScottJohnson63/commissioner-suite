"""Loading and upserting nflverse weekly player stats.

Shared by sync_nfl_weekly (one week, in season), load_completed_season (the
finished season each August) and backfill_nfl_seasons (history, run by hand).

COLUMN_MAP is deliberately narrower than what nflverse returns: it lists exactly
the columns NflWeeklyStat keeps. Anything not named here is dropped before it
reaches the database, so adding a column means adding it in both this map and
prisma/schema.prisma.
"""
from __future__ import annotations

import nflreadpy as nfl
import polars as pl

from common import turso

# nflverse source column → NflWeeklyStat column.
COLUMN_MAP: dict[str, str] = {
    # ── Identity ──────────────────────────────────────────────────────
    "game_id": "gameId",
    "player_id": "playerId",
    "player_name": "playerName",
    "player_display_name": "playerDisplayName",
    "position": "position",
    "position_group": "positionGroup",
    "season": "season",
    "week": "week",
    "season_type": "seasonType",
    "team": "team",
    "opponent_team": "opponentTeam",
    # ── Passing ───────────────────────────────────────────────────────
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
    "passing_10": "passing10",
    "passing_16": "passing16",
    "passing_20": "passing20",
    "passing_40": "passing40",
    # ── Rushing ───────────────────────────────────────────────────────
    "carries": "carries",
    "rushing_yards": "rushingYards",
    "rushing_tds": "rushingTds",
    "rushing_fumbles": "rushingFumbles",
    "rushing_fumbles_lost": "rushingFumblesLost",
    "rushing_first_downs": "rushingFirstDowns",
    "rushing_epa": "rushingEpa",
    "rushing_2pt_conversions": "rushing2ptConversions",
    "rushing_10": "rushing10",
    "rushing_12": "rushing12",
    "rushing_20": "rushing20",
    "rushing_40": "rushing40",
    # ── Receiving ─────────────────────────────────────────────────────
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
    "receiving_10": "receiving10",
    "receiving_16": "receiving16",
    "receiving_20": "receiving20",
    "receiving_40": "receiving40",
    "racr": "racr",
    "target_share": "targetShare",
    "air_yards_share": "airYardsShare",
    "wopr": "wopr",
    # ── Defense ───────────────────────────────────────────────────────
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
    "def_punt_blocks": "defPuntBlocks",
    "def_pat_blocks": "defPatBlocks",
    "def_fg_blocks": "defFgBlocks",
    "def_2pt_atts": "def2ptAtts",
    "def_2pt_made": "def2ptMade",
    # ── Kicking ───────────────────────────────────────────────────────
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
    "fg_made_list": "fgMadeList",
    "fg_missed_list": "fgMissedList",
    "fg_blocked_list": "fgBlockedList",
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
    # ── Punting ───────────────────────────────────────────────────────
    "pt_att": "ptAtt",
    "pt_blocked": "ptBlocked",
    "pt_long": "ptLong",
    "pt_yards": "ptYards",
    "pt_inside_20": "ptInside20",
    "pt_out_of_bounds": "ptOutOfBounds",
    "pt_downed": "ptDowned",
    "pt_touchback": "ptTouchback",
    "pt_fair_caught": "ptFairCaught",
    "pt_returned": "ptReturned",
    "pt_return_yards": "ptReturnYards",
    "pt_return_tds": "ptReturnTds",
    "pt_net_yards": "ptNetYards",
    # ── Returns / misc ────────────────────────────────────────────────
    "special_teams_tds": "specialTeamsTds",
    "misc_yards": "miscYards",
    "fumble_recovery_own": "fumbleRecoveryOwn",
    "fumble_recovery_yards_own": "fumbleRecoveryYardsOwn",
    "fumble_recovery_opp": "fumbleRecoveryOpp",
    "fumble_recovery_yards_opp": "fumbleRecoveryYardsOpp",
    "fumble_recovery_tds": "fumbleRecoveryTds",
    "penalties": "penalties",
    "penalty_yards": "penaltyYards",
    "fumbles_forced_by_opp": "fumblesForcedByOpp",
    "fumbles_not_forced": "fumblesNotForced",
    "fumbles_out_of_bounds": "fumblesOutOfBounds",
    "fumbles_total": "fumblesTotal",
    "fumbles_lost_total": "fumblesLostTotal",
    "punt_returns": "puntReturns",
    "punt_return_yards": "puntReturnYards",
    "kickoff_returns": "kickoffReturns",
    "kickoff_return_yards": "kickoffReturnYards",
    # ── Fantasy ───────────────────────────────────────────────────────
    "fantasy_points": "fantasyPoints",
    "fantasy_points_ppr": "fantasyPointsPpr",
    # ── Other ────────────────────────────────────────────────────────────
    "headshot_url": "headshot",
}

# Columns stored as TEXT — everything else is cast to Float64.
TEXT_COLUMNS: frozenset[str] = frozenset({
    "fgBlockedList", "fgMadeList", "fgMissedList", "gameId", "headshot",
    "opponentTeam", "playerDisplayName", "playerId", "playerName", "position",
    "positionGroup", "seasonType", "team",
})

# Part of the unique key, so never included in the ON CONFLICT update list.
KEY_COLUMNS: frozenset[str] = frozenset({"season", "week", "playerId"})


def _narrow(df: pl.DataFrame) -> pl.DataFrame:
    """Selects and renames the stored columns, then normalises numeric types."""
    available = [c for c in COLUMN_MAP if c in df.columns]
    df = df.select(available).rename({c: COLUMN_MAP[c] for c in available})
    df = df.filter(pl.col("playerId").is_not_null())

    return df.with_columns([
        pl.col(c).cast(pl.Float64, strict=False)
        for c in df.columns
        if c not in TEXT_COLUMNS and df[c].dtype != pl.Utf8
    ])


def load_seasons(seasons: list[int]) -> pl.DataFrame:
    """Loads every published week for the given seasons."""
    return _narrow(nfl.load_player_stats(seasons))


def load_latest_week(season: int) -> tuple[pl.DataFrame, int]:
    """Loads only the most recent week nflverse has published for `season`.

    Returns the rows and the week number. One fetch serves both — nflverse ships
    the whole season in a single file, so re-reading it to find the max week
    would double the download for no gain.
    """
    df = nfl.load_player_stats([season])
    week = df.select(pl.col("week").max()).item()
    return _narrow(df.filter(pl.col("week") == week)), week


def rows_per_season() -> dict[int, int]:
    """How many rows NflWeeklyStat already holds for each season.

    Used to skip a season that is already loaded. Re-uploading one costs
    minutes and achieves nothing when the row count already matches what
    nflverse is offering.
    """
    rows = turso.query(
        'SELECT season, COUNT(*) AS n FROM "NflWeeklyStat" GROUP BY season'
    )
    return {int(r["season"]): int(r["n"]) for r in rows}


def upsert(df: pl.DataFrame) -> int:
    """Upserts every row keyed on (season, week, playerId). Returns rows written."""
    cols = df.columns
    col_names = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join("?" for _ in cols)
    updates = ", ".join(
        f'"{c}" = excluded."{c}"' for c in cols if c not in KEY_COLUMNS
    )

    sql = (
        f"INSERT INTO NflWeeklyStat (id, {col_names}) "
        f"VALUES (lower(hex(randomblob(16))), {placeholders}) "
        f'ON CONFLICT (season, week, "playerId") DO UPDATE SET {updates}'
    )

    rows = [[row[c] for c in cols] for row in df.to_dicts()]
    return turso.execute_chunked(sql, rows, label="stat rows")


def truncate() -> None:
    """Empties NflWeeklyStat.

    No scheduled job calls this any more. The annual August load used to
    truncate before reloading a rolling window of seasons; it now appends the
    finished season and deletes nothing, because the card pool is built from
    every season in the table and a wipe threw away history the game depends on
    — including a 1999+ backfill that takes four hours to rebuild.

    Kept as a maintenance tool for a deliberate, manual rebuild. If you are
    about to call it, you are about to lose every season not in whatever you
    load next.
    """
    print("Truncating NflWeeklyStat...")
    turso.execute_one('DELETE FROM "NflWeeklyStat"')
    print("  Table cleared.")
