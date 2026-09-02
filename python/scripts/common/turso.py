"""Minimal Turso (libSQL) HTTP client used by every sync script.

Turso exposes a `/v2/pipeline` endpoint that accepts a batch of statements in one
round trip. Batching matters here: the sync jobs write thousands of rows, and one
HTTP request per row would take minutes and risk rate limiting.
"""
from __future__ import annotations

import json
import math
import os
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Iterable, Sequence

import certifi

from common.net import require_https

# GitHub runners ship without the CA bundle urllib expects, so point the default
# HTTPS context at certifi for both this module and nflreadpy's downloads.
ssl._create_default_https_context = lambda: ssl.create_default_context(
    cafile=certifi.where()
)

# One request can carry a hundred rows of 150 columns, and Turso is a remote
# service over the public internet. Thirty seconds was enough for the small
# league syncs and too tight for a stat backfill, where a single slow chunk
# killed a job that had already uploaded thousands of rows.
TIMEOUT_SECONDS = 120

# A backfill of 1999-2022 is roughly four thousand requests. At that volume a
# transient timeout or a 5xx is not an exception, it is a certainty — so the
# ones worth retrying are retried rather than taking the whole job down.
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 2.0

# Rows per pipeline request.
#
# Not a conservative number — a hundred rows of the 150-column NflWeeklyStat
# serialises to roughly 800 KB, which is close to Turso's request ceiling rather
# than "well under" it. That size is also why a stat backfill needs the long
# timeout and the retries above: it is uploading the better part of a megabyte
# per request, thousands of times, over the public internet.
#
# Raising this is not a free speed-up. Measure the payload first — 250 rows is
# already over 2 MB and will be rejected.
DEFAULT_CHUNK_SIZE = 100


def _pipeline_url() -> str:
    """The Turso pipeline endpoint, derived from TURSO_DATABASE_URL.

    Turso hands out libsql:// URLs; the HTTP API lives at the same host over
    https. The scheme is checked rather than assumed, so a secret holding
    anything else fails loudly here instead of being opened as-is.
    """
    base = os.environ["TURSO_DATABASE_URL"].replace("libsql://", "https://", 1)
    return f"{require_https(base)}/v2/pipeline"


def _post(requests: list[dict[str, Any]]) -> dict[str, Any]:
    # allow_nan=False turns any remaining non-finite value into a ValueError
    # here, naming this module, rather than a parse error from Turso pointing
    # at a character offset in a 100 KB request body.
    payload = json.dumps({"requests": requests}, allow_nan=False).encode("utf-8")
    req = urllib.request.Request(
        _pipeline_url(),
        data=payload,
        headers={
            "Authorization": f"Bearer {os.environ['TURSO_AUTH_TOKEN']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    last_error: Exception | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
            # The URL comes from TURSO_DATABASE_URL, not from user input, and
            # _pipeline_url rejects it unless it is https with a host. See
            # tests/test_net.py.
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
                return json.loads(res.read())

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            error = RuntimeError(f"Turso HTTP {e.code}: {body}")
            # 4xx means the request itself is wrong — a malformed statement, a
            # bad token, a constraint violation. Retrying sends the identical
            # bytes and gets the identical answer, so fail now with the body,
            # which is the part that says what was actually wrong.
            if e.code < 500:
                raise error from e
            last_error = error

        except (TimeoutError, urllib.error.URLError, ConnectionError) as e:
            # The transient family: a read that ran long, a dropped connection,
            # DNS blipping. Worth another go.
            last_error = e

        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_SECONDS * (2 ** (attempt - 1))
            print(
                f"  ⚠ Turso request failed ({type(last_error).__name__}), "
                f"retrying in {delay:.0f}s — attempt {attempt + 1} of {MAX_ATTEMPTS}"
            )
            time.sleep(delay)

    raise RuntimeError(
        f"Turso request failed after {MAX_ATTEMPTS} attempts: {last_error}"
    ) from last_error


def to_arg(val: Any) -> dict[str, Any]:
    """Converts a Python value into a Turso typed argument.

    Integers are sent as *strings*. That is not a quirk of this code: Turso's
    Hrana JSON protocol encodes 64-bit integers as strings so that a JSON parser
    with double-precision numbers cannot silently round them. Sending a bare
    JSON number is rejected with "invalid type: integer, expected a borrowed
    string".

    Floats stay as JSON numbers, which is what the protocol asks for.
    """
    if val is None:
        return {"type": "null", "value": None}
    # bool is a subclass of int, so it has to be checked first.
    if isinstance(val, bool):
        return {"type": "integer", "value": str(int(val))}
    if isinstance(val, int):
        return {"type": "integer", "value": str(val)}
    if isinstance(val, float):
        # NaN and infinity become NULL. They are not representable in JSON --
        # json.dumps writes a bare `NaN`, which Turso's parser rejects with an
        # opaque "expected value at column N" several thousand characters into
        # the payload -- and NULL is what they mean anyway: nflverse produces
        # them for ratios like wopr and airYardsShare in seasons before air
        # yards were tracked, where the denominator is zero. An undefined ratio
        # is unknown, not a number.
        if math.isnan(val) or math.isinf(val):
            return {"type": "null", "value": None}
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

    Sequential on purpose. Three ways of speeding a backfill up were measured
    and all three are dead ends, so do not spend the afternoon on them again:

      * Bigger chunks. A hundred rows is already ~800 KB, close to Turso's
        request ceiling; 250 rows is over 2 MB and is rejected.

      * Concurrent chunks. Sending six at once measured *slower* than one at a
        time — 1,393 rows a minute against 1,666. The constraint is upload
        throughput (~143 MB in 757 s, about 1.5 Mbps), not round-trip latency,
        and parallel requests only divide the same pipe.

      * Compressing the body. It would be the real fix — the payload is mostly
        numbers and nulls and gzips 48x, 825 KB down to 17 KB — but Turso
        answers a gzipped body with a 400.

    Which leaves roughly ten minutes a season, and the only useful saving is
    not uploading a season twice. See backfill_nfl_seasons.py, which skips a
    season whose row count already matches.

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
