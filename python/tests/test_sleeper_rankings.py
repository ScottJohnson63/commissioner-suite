import pytest

import sync_sleeper_rankings as rankings
from common import sleeper


def season_record(user_id, wins, losses, ties=0, display="Ana", team=None):
    return {user_id: {"displayName": display, "teamName": team,
                      "wins": wins, "losses": losses, "ties": ties}}


def test_merge_seasons_sums_totals_across_seasons():
    merged = rankings.merge_seasons([
        season_record("u1", 10, 4),
        season_record("u1", 7, 7),
    ])

    assert merged["u1"]["wins"] == 17
    assert merged["u1"]["losses"] == 11
    assert merged["u1"]["seasons"] == 2


def test_merge_seasons_keeps_the_most_recent_display_name():
    merged = rankings.merge_seasons([
        season_record("u1", 1, 0, display="OldName"),
        season_record("u1", 1, 0, display="NewName"),
    ])

    assert merged["u1"]["displayName"] == "NewName"


def test_merge_seasons_keeps_the_last_non_empty_team_name():
    merged = rankings.merge_seasons([
        season_record("u1", 1, 0, team="Dynasty"),
        season_record("u1", 1, 0, team=None),
    ])

    # A manager who cleared their team name should not lose the one we know.
    assert merged["u1"]["teamName"] == "Dynasty"


def test_merge_seasons_handles_no_data():
    assert rankings.merge_seasons([]) == {}


def test_find_unsynced_walks_the_chain_until_a_known_season(monkeypatch):
    chain = {
        "2026": {"previous_league_id": "2025"},
        "2025": {"previous_league_id": "2024"},
        "2024": {"previous_league_id": None},
    }
    monkeypatch.setattr(sleeper, "get", lambda path: chain[path.split("/")[-1]])

    # 2024 is already recorded, so the walk stops before fetching it.
    assert rankings.find_unsynced_seasons("2026", {"2024"}) == ["2025", "2026"]


def test_find_unsynced_returns_oldest_first(monkeypatch):
    chain = {
        "2026": {"previous_league_id": "2025"},
        "2025": {"previous_league_id": None},
    }
    monkeypatch.setattr(sleeper, "get", lambda path: chain[path.split("/")[-1]])

    assert rankings.find_unsynced_seasons("2026", set()) == ["2025", "2026"]


def test_find_unsynced_returns_nothing_when_already_current(monkeypatch):
    def fail(path):
        raise AssertionError("should not call Sleeper for a known season")

    monkeypatch.setattr(sleeper, "get", fail)
    assert rankings.find_unsynced_seasons("2026", {"2026"}) == []


def test_find_unsynced_stops_on_an_unfetchable_league(monkeypatch):
    monkeypatch.setattr(sleeper, "get", lambda path: None)
    assert rankings.find_unsynced_seasons("2026", set()) == []


def test_fetch_season_records_skips_rosters_without_an_owner(monkeypatch):
    monkeypatch.setattr(sleeper, "get", lambda path: {
        "/league/x/rosters": [
            {"owner_id": "u1", "settings": {"wins": 9, "losses": 5, "ties": 0}},
            {"owner_id": None, "settings": {"wins": 1, "losses": 1}},
        ],
        "/league/x/users": [
            {"user_id": "u1", "display_name": "Ana", "metadata": {"team_name": "Dynasty"}},
        ],
    }[path])

    records = rankings.fetch_season_records("x")

    assert list(records) == ["u1"]
    assert records["u1"] == {
        "displayName": "Ana", "teamName": "Dynasty",
        "wins": 9, "losses": 5, "ties": 0,
    }


def test_fetch_season_records_returns_empty_when_sleeper_has_no_data(monkeypatch):
    monkeypatch.setattr(sleeper, "get", lambda path: [])
    assert rankings.fetch_season_records("x") == {}
