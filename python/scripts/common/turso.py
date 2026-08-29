"""Minimal Turso (libSQL) HTTP client used by every sync script.

Turso exposes a `/v2/pipeline` endpoint that accepts a batch of statements in one
round trip. Batching matters here: the sync jobs write thousands of rows, and one
HTTP request per row would take minutes and risk rate limiting.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from typing import Any, Iterable, Sequence

import certifi

# GitHub runners ship without the CA bundle urllib expects, so point the default
# HTTPS context at certifi for both this module and nflreadpy's downloads.
ssl._create_default_https_context = lambda: ssl.create_default_context(
    cafile=certifi.where()
)

TIMEOUT_SECONDS = 30

# Rows per pipeline request. 100 keeps each payload well under Turso's request
# size ceiling while still cutting round trips by two orders of magnitude.
DEFAULT_CHUNK_SIZE = 100


def _pipeline_url() -> str:
    base = os.environ["TURSO_DATABASE_URL"].replace("libsql://", "https://")
    return f"{base}/v2/pipeline"


def _post(requests: list[dict[str, Any]]) -> dict[str, Any]:
    payload = json.dumps({"requests": requests}).encode("utf-8")
    req = urllib.request.Request(
        _pipeline_url(),
        data=payload,
        headers={
            "Authorization": f"Bearer {os.environ['TURSO_AUTH_TOKEN']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Turso HTTP {e.code}: {body}") from e


def to_arg(val: Any) -> dict[str, Any]:
    """Converts a Python value into a Turso typed argument."""
    if val is None:
        return {"type": "null", "value": None}
    # bool is a subclass of int, so it has to be checked first.
    if isinstance(val, bool):
        return {"type": "integer", "value": int(val)}
    if isinstance(val, int):
        return {"type": "integer", "value": val}
    if isinstance(val, float):
        return {"type": "float", "value": val}
    return {"type": "text", "value": str(val)}


def statement(sql: str, args: Sequence[Any] = ()) -> dict[str, Any]:
    """Builds one pipeline statement from SQL and positional arguments."""
    return {
        "type": "execute",
        "stmt": {"sql": sql, "args": [to_arg(a) for a in args]},
    }


def execute(statements: list[dict[str, Any]]) -> None:
    """Runs a batch of statements, raising on the first one that fails."""
    if not statements:
        return
    result = _post(statements)
    for i, r in enumerate(result.get("results", [])):
        if r.get("type") == "error":
            raise RuntimeError(f"Statement {i} failed: {r['error']}")


def execute_one(sql: str, args: Sequence[Any] = ()) -> None:
    """Runs a single write statement."""
    execute([statement(sql, args)])


def query(sql: str, args: Sequence[Any] = ()) -> list[dict[str, Any]]:
    """Runs a SELECT and returns rows as dicts keyed by column name."""
    result = _post([statement(sql, args)])
    result_set = result["results"][0]
    if result_set.get("type") == "error":
        raise RuntimeError(f"Query error: {result_set['error']}")

    data = result_set["response"]["result"]
    cols = [c["name"] for c in data["cols"]]
    return [
        {
            cols[i]: (cell["value"] if cell["type"] != "null" else None)
            for i, cell in enumerate(row)
        }
        for row in data["rows"]
    ]


def execute_chunked(
    sql: str,
    rows: Iterable[Sequence[Any]],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    label: str = "rows",
) -> int:
    """Runs the same SQL for many argument tuples, batched into pipeline requests.

    Returns the number of rows written.
    """
    rows = list(rows)
    total = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i: i + chunk_size]
        execute([statement(sql, args) for args in chunk])
        total += len(chunk)
        print(f"  Wrote {total}/{len(rows)} {label}")
    return total
