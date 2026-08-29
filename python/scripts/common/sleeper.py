"""Sleeper API access for the sync scripts.

Mirrors nextjs/src/lib/sleeper/client.ts: one place that owns the base URL and
the courtesy delay, so request volume against Sleeper stays predictable.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from common.net import require_https

SLEEPER_BASE = "https://api.sleeper.app/v1"
USER_AGENT = "commissioner-suite/1.0"
TIMEOUT_SECONDS = 10

# Sleeper publishes no hard rate limit but asks callers to be courteous. The
# ranking sync walks every prior season of every league, so it can otherwise
# fire hundreds of requests back to back.
COURTESY_DELAY_SECONDS = 0.1


SLEEPER_HOST = urlsplit(SLEEPER_BASE).hostname or ""


def get(path: str) -> Any:
    """Fetches a Sleeper endpoint and returns the parsed JSON body.

    `path` is a relative path built by the callers from league and user ids, so
    it is pinned to the Sleeper host — an id carrying "../" or an absolute URL
    cannot redirect the request elsewhere.
    """
    if not path.startswith("/"):
        raise ValueError(f"Sleeper path must start with '/': {path!r}")

    url = require_https(f"{SLEEPER_BASE}{path}", allowed_host=SLEEPER_HOST)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        # The URL is dynamic, but require_https above has already pinned it to
        # https on api.sleeper.app, so the file:// read this rule guards against
        # cannot be reached. See tests/test_net.py.
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            body = json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Sleeper HTTP {e.code} for {path}") from e
    time.sleep(COURTESY_DELAY_SECONDS)
    return body


def current_state() -> dict[str, Any]:
    """Returns Sleeper's NFL state (current week, season, season_type)."""
    return get("/state/nfl")


def last_completed_week() -> int:
    """The most recently finished regular-season week.

    During the regular season Sleeper's `week` is the week in progress, so the
    last completed week is one behind. Outside it, week 18 is the last one that
    produced regular-season scores.
    """
    state = current_state()
    if state.get("season_type") == "regular":
        return max(1, state.get("week", 1) - 1)
    return 18
