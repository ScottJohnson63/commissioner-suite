import pytest

from common import turso


def test_to_arg_types():
    assert turso.to_arg(None) == {"type": "null", "value": None}
    assert turso.to_arg(7) == {"type": "integer", "value": 7}
    assert turso.to_arg(1.5) == {"type": "float", "value": 1.5}
    assert turso.to_arg("x") == {"type": "text", "value": "x"}


def test_to_arg_treats_bool_as_integer_not_text():
    # bool subclasses int, so the isinstance order in to_arg matters.
    assert turso.to_arg(True) == {"type": "integer", "value": 1}
    assert turso.to_arg(False) == {"type": "integer", "value": 0}


def test_statement_binds_positional_args():
    stmt = turso.statement("SELECT ? , ?", ["a", 2])
    assert stmt["type"] == "execute"
    assert stmt["stmt"]["sql"] == "SELECT ? , ?"
    assert stmt["stmt"]["args"] == [
        {"type": "text", "value": "a"},
        {"type": "integer", "value": 2},
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
