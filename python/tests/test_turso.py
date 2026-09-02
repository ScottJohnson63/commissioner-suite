import io
import json

import pytest

from common import turso


def test_to_arg_types():
    assert turso.to_arg(None) == {"type": "null", "value": None}
    assert turso.to_arg(1.5) == {"type": "float", "value": 1.5}
    assert turso.to_arg("x") == {"type": "text", "value": "x"}


def test_to_arg_encodes_integers_as_strings():
    # Turso's Hrana JSON protocol encodes 64-bit integers as strings, so that a
    # JSON parser using double-precision numbers cannot silently round them.
    # Sending a bare JSON number is rejected outright:
    #   "invalid type: integer, expected a borrowed string"
    assert turso.to_arg(7) == {"type": "integer", "value": "7"}
    assert turso.to_arg(0) == {"type": "integer", "value": "0"}
    assert turso.to_arg(-3) == {"type": "integer", "value": "-3"}


def test_to_arg_treats_bool_as_integer_not_text():
    # bool subclasses int, so the isinstance order in to_arg matters.
    assert turso.to_arg(True) == {"type": "integer", "value": "1"}
    assert turso.to_arg(False) == {"type": "integer", "value": "0"}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_to_arg_sends_non_finite_floats_as_null(value):
    # JSON has no NaN or Infinity: json.dumps writes a bare `NaN`, which Turso
    # rejects with an opaque parse error pointing at a character offset deep in
    # the request body. NULL is also what they mean -- nflverse produces them
    # for ratios like wopr in seasons before air yards were tracked, where the
    # denominator is zero, and an undefined ratio is unknown rather than a
    # number.
    assert turso.to_arg(value) == {"type": "null", "value": None}


def test_a_batch_of_real_stat_rows_serialises_to_valid_json():
    # The end-to-end property the two rules above exist for. allow_nan=False
    # mirrors what _post does, so anything non-finite raises here rather than
    # producing JSON that only fails once Turso has seen it.
    stmt = turso.statement(
        "INSERT INTO t VALUES (?, ?, ?, ?)",
        [1999, "00-0000001", float("nan"), 12.5],
    )
    json.dumps({"requests": [stmt]}, allow_nan=False)


def test_statement_binds_positional_args():
    stmt = turso.statement("SELECT ? , ?", ["a", 2])
    assert stmt["type"] == "execute"
    assert stmt["stmt"]["sql"] == "SELECT ? , ?"
    assert stmt["stmt"]["args"] == [
        {"type": "text", "value": "a"},
        {"type": "integer", "value": "2"},
    ]


def test_execute_is_a_noop_for_an_empty_batch(monkeypatch):
    def fail(_):
        raise AssertionError("should not have issued a request")

    monkeypatch.setattr(turso, "_post", fail)
    turso.execute([])


def test_execute_raises_on_a_failed_statement(monkeypatch):
    monkeypatch.setattr(
        turso, "_post",
        lambda _: {"results": [{"type": "ok"}, {"type": "error", "error": "boom"}]},
    )
    with pytest.raises(RuntimeError, match="Statement 1 failed: boom"):
        turso.execute([turso.statement("SELECT 1"), turso.statement("SELECT 2")])


def test_query_maps_rows_onto_column_names(monkeypatch):
    monkeypatch.setattr(turso, "_post", lambda _: {
        "results": [{
            "type": "ok",
            "response": {"result": {
                "cols": [{"name": "id"}, {"name": "pts"}],
                "rows": [
                    [{"type": "text", "value": "a"}, {"type": "float", "value": 1.5}],
                    [{"type": "text", "value": "b"}, {"type": "null", "value": None}],
                ],
            }},
        }],
    })

    assert turso.query("SELECT id, pts FROM t") == [
        {"id": "a", "pts": 1.5},
        {"id": "b", "pts": None},
    ]


def test_execute_chunked_batches_by_chunk_size(monkeypatch):
    batches = []
    monkeypatch.setattr(turso, "execute", lambda stmts: batches.append(len(stmts)))

    written = turso.execute_chunked("INSERT INTO t VALUES (?)", [[i] for i in range(250)], chunk_size=100)

    assert written == 250
    assert batches == [100, 100, 50]


# ── Retry behaviour ───────────────────────────────────────────────────────────
#
# A 1999-2022 backfill is roughly four thousand requests, so a transient failure
# is a certainty rather than an exception — one killed a real run partway. What
# matters is retrying the failures that can succeed on a second try and *not*
# retrying the ones that cannot, since a 4xx repeated four times just delays a
# clear error message by fourteen seconds.

class _FakeResponse:
    def __init__(self, body):
        self._body = json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _no_sleep(monkeypatch):
    monkeypatch.setattr(turso.time, "sleep", lambda _: None)


def test_post_retries_a_timeout_and_succeeds(monkeypatch):
    _no_sleep(monkeypatch)
    calls = []

    def flaky(_req, timeout):  # noqa: ARG001
        calls.append(1)
        if len(calls) < 3:
            raise TimeoutError("read timed out")
        return _FakeResponse({"results": []})

    monkeypatch.setattr(turso.urllib.request, "urlopen", flaky)
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://example.turso.io")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "t")

    assert turso._post([]) == {"results": []}
    assert len(calls) == 3


def test_post_gives_up_after_max_attempts(monkeypatch):
    _no_sleep(monkeypatch)
    calls = []

    def always_times_out(_req, timeout):  # noqa: ARG001
        calls.append(1)
        raise TimeoutError("read timed out")

    monkeypatch.setattr(turso.urllib.request, "urlopen", always_times_out)
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://example.turso.io")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "t")

    with pytest.raises(RuntimeError, match="after 4 attempts"):
        turso._post([])
    assert len(calls) == turso.MAX_ATTEMPTS


def test_post_does_not_retry_a_client_error(monkeypatch):
    # A 400 means the request is wrong — a malformed statement, a bad token.
    # Sending the identical bytes again gets the identical answer, so this must
    # fail immediately and surface the body, which says what was wrong.
    _no_sleep(monkeypatch)
    calls = []

    def bad_request(_req, timeout):  # noqa: ARG001
        calls.append(1)
        raise turso.urllib.error.HTTPError(
            "https://example.turso.io", 400, "Bad Request", {},
            io.BytesIO(b'{"error":"JSON parse error"}'),
        )

    monkeypatch.setattr(turso.urllib.request, "urlopen", bad_request)
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://example.turso.io")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "t")

    with pytest.raises(RuntimeError, match="Turso HTTP 400"):
        turso._post([])
    assert len(calls) == 1


def test_post_retries_a_server_error(monkeypatch):
    # 5xx is the server having a moment, which is exactly what a retry is for.
    _no_sleep(monkeypatch)
    calls = []

    def flaky(_req, timeout):  # noqa: ARG001
        calls.append(1)
        if len(calls) == 1:
            raise turso.urllib.error.HTTPError(
                "https://example.turso.io", 503, "Unavailable", {}, io.BytesIO(b"busy"),
            )
        return _FakeResponse({"results": ["ok"]})

    monkeypatch.setattr(turso.urllib.request, "urlopen", flaky)
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://example.turso.io")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "t")

    assert turso._post([]) == {"results": ["ok"]}
    assert len(calls) == 2
