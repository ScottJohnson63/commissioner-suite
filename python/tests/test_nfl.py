# python/tests/test_nfl.py

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def make_player_df() -> pd.DataFrame:
    return pd.DataFrame([
        {"player_id": "4046", "display_name": "Tom Brady", "position": "QB"},
        {"player_id": "7564", "display_name": "Aaron Rodgers", "position": "QB"},
    ])


def make_weekly_df() -> pd.DataFrame:
    return pd.DataFrame([
        {"player_id": "4046", "week": 5, "season": 2024, "passing_yards": 320},
        {"player_id": "7564", "week": 5, "season": 2024, "passing_yards": 275},
    ])


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@patch("routers.nfl.nfl.import_players")
def test_get_players_success(mock_import: MagicMock) -> None:
    mock_import.return_value = make_player_df()

    res = client.get("/nfl/players")
    assert res.status_code == 200

    data = res.json()
    assert len(data) == 2
    assert data[0]["player_id"] == "4046"


@patch("routers.nfl.nfl.import_players")
def test_get_players_upstream_error(mock_import: MagicMock) -> None:
    mock_import.side_effect = Exception("nfl_data_py network error")

    res = client.get("/nfl/players")
    assert res.status_code == 502
    assert "nfl_data_py network error" in res.json()["detail"]


@patch("routers.nfl.nfl.import_weekly_data")
def test_get_weekly_stats_required_param(mock_import: MagicMock) -> None:
    """season is required — should 422 without it."""
    res = client.get("/nfl/weekly")
    assert res.status_code == 422


@patch("routers.nfl.nfl.import_weekly_data")
def test_get_weekly_stats_success(mock_import: MagicMock) -> None:
    mock_import.return_value = make_weekly_df()

    res = client.get("/nfl/weekly?season=2024")
    assert res.status_code == 200

    data = res.json()
    assert len(data) == 2
    assert data[0]["season"] == 2024


@patch("routers.nfl.nfl.import_weekly_data")
def test_get_weekly_stats_week_filter(mock_import: MagicMock) -> None:
    mock_import.return_value = make_weekly_df()

    res = client.get("/nfl/weekly?season=2024&week=5")
    assert res.status_code == 200
    assert all(row["week"] == 5 for row in res.json())


@patch("routers.nfl.nfl.import_weekly_data")
def test_get_weekly_stats_invalid_week(mock_import: MagicMock) -> None:
    res = client.get("/nfl/weekly?season=2024&week=99")
    assert res.status_code == 422


@patch("routers.nfl.nfl.import_seasonal_data")
def test_get_seasonal_stats_success(mock_import: MagicMock) -> None:
    mock_import.return_value = pd.DataFrame([
        {"player_id": "4046", "season": 2024, "passing_yards": 4800},
    ])

    res = client.get("/nfl/seasonal?season=2024")
    assert res.status_code == 200
    assert res.json()[0]["passing_yards"] == 4800


@patch("routers.nfl.nfl.import_schedules")
def test_get_schedules_success(mock_import: MagicMock) -> None:
    mock_import.return_value = pd.DataFrame([
        {"game_id": "2024_01_KC_BAL", "season": 2024, "week": 1},
    ])

    res = client.get("/nfl/schedules?season=2024")
    assert res.status_code == 200
    assert res.json()[0]["week"] == 1