"""Tests for the outbound-HTTP guard.

urlopen will happily open file:// and read a local path. Nothing in these
scripts passes user input to it, but the guard is what makes that a checked
property rather than an assumption — so these tests pin the refusals.
"""
from __future__ import annotations

import pytest

from common.net import require_https


class TestRequireHttps:
    def test_passes_a_plain_https_url_through_unchanged(self) -> None:
        url = "https://api.sleeper.app/v1/state/nfl"
        assert require_https(url) == url

    # The exact scheme Semgrep warns about: urlopen would read the local file.
    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "http://api.sleeper.app/v1/state/nfl",
            "ftp://example.com/data",
            "libsql://db.turso.io",
        ],
    )
    def test_refuses_any_scheme_that_is_not_https(self, url: str) -> None:
        with pytest.raises(ValueError, match="non-HTTPS"):
            require_https(url)

    def test_refuses_a_url_with_no_host(self) -> None:
        with pytest.raises(ValueError, match="no host"):
            require_https("https:///v2/pipeline")

    def test_accepts_a_matching_host(self) -> None:
        url = "https://api.sleeper.app/v1/user/123"
        assert require_https(url, allowed_host="api.sleeper.app") == url

    # A league id is interpolated into the path, so pinning the host is what
    # stops a malformed one pointing the request somewhere else entirely.
    def test_refuses_a_host_that_is_not_the_expected_one(self) -> None:
        with pytest.raises(ValueError, match="expected"):
            require_https("https://evil.example/v1", allowed_host="api.sleeper.app")

    def test_host_check_ignores_the_port(self) -> None:
        url = "https://api.sleeper.app:443/v1"
        assert require_https(url, allowed_host="api.sleeper.app") == url


class TestSleeperPaths:
    def test_rejects_a_path_that_is_not_relative(self) -> None:
        from common import sleeper

        with pytest.raises(ValueError, match="must start with"):
            sleeper.get("https://evil.example/steal")

    def test_rejects_a_bare_path(self) -> None:
        from common import sleeper

        with pytest.raises(ValueError, match="must start with"):
            sleeper.get("state/nfl")


class TestTursoPipelineUrl:
    def test_converts_libsql_to_https(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from common import turso

        monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://db-abc.turso.io")
        assert turso._pipeline_url() == "https://db-abc.turso.io/v2/pipeline"

    # A mistyped or hostile secret should fail here rather than become a request.
    @pytest.mark.parametrize(
        "value", ["file:///etc/passwd", "http://db-abc.turso.io", "not-a-url"]
    )
    def test_refuses_a_database_url_that_is_not_https(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        from common import turso

        monkeypatch.setenv("TURSO_DATABASE_URL", value)
        with pytest.raises(ValueError):
            turso._pipeline_url()
