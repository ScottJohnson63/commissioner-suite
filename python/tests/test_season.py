from datetime import datetime, timezone

import pytest

from common import season


def at(month: int, day: int = 15) -> datetime:
    return datetime(2026, month, day, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_force(monkeypatch):
    """FORCE short-circuits both guards, so keep it off unless a test sets it."""
    monkeypatch.delenv("FORCE", raising=False)


@pytest.mark.parametrize("month", [8, 9, 10, 11, 12, 1])
def test_in_season_during_the_season(month):
    assert season.is_in_season(at(month)) is True


def test_in_season_includes_february_first():
    assert season.is_in_season(at(2, 1)) is True


@pytest.mark.parametrize("month", [2, 3, 4, 5, 6, 7])
def test_out_of_season_in_the_offseason(month):
    assert season.is_in_season(at(month, 15)) is False


def test_force_overrides_the_season_window(monkeypatch):
    monkeypatch.setenv("FORCE", "true")
    assert season.is_in_season(at(5)) is True


def test_reset_day_is_only_august_first():
    assert season.is_reset_day(at(8, 1)) is True
    assert season.is_reset_day(at(8, 2)) is False
    assert season.is_reset_day(at(7, 31)) is False


def test_current_season_reads_the_env(monkeypatch):
    monkeypatch.setenv("NFL_SEASON", "2024")
    assert season.current_season() == 2024


def test_trigger_marks_workflow_dispatch_as_manual(monkeypatch):
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    assert season.trigger() == "manual"
    monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
    assert season.trigger() == "schedule"
