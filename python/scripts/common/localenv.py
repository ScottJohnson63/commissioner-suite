"""Loads database credentials from the Next.js .env files for local runs.

These scripts are built for GitHub Actions, where TURSO_DATABASE_URL and friends
arrive as injected secrets. Run one by hand and nothing has ever put them in the
environment, so the first database call dies with a bare KeyError several
seconds into a job that has already downloaded a season of stats.

The credentials live in nextjs/.env and nextjs/.env.local because the web app
owns them; there is no second copy on the Python side and there should not be
one. This reads those files rather than duplicating the secrets.

Two rules, both deliberate:

  * Existing environment variables always win. In CI the secrets are already
    set and there are no .env files to read anyway, so this is a no-op there —
    but if both were ever present, the injected secret is the real one.

  * A missing file is not an error. A checkout without .env.local is normal.
"""
from __future__ import annotations

import os
from pathlib import Path

# nextjs/.env then nextjs/.env.local, matching the precedence the app itself
# uses — .env.local overrides .env, and both defer to the real environment.
_ENV_FILES = ("../nextjs/.env", "../nextjs/.env.local")

_loaded = False


def load() -> None:
    """Fills in any credentials the environment is missing. Safe to call twice."""
    global _loaded
    if _loaded:
        return
    _loaded = True

    try:
        from dotenv import load_dotenv
    except ImportError:
        # python-dotenv is in requirements.txt, but a script should not die
        # because a local venv is missing an optional convenience.
        return

    root = Path(__file__).resolve().parents[2]  # python/scripts/common -> python/
    for relative in _ENV_FILES:
        path = (root / relative).resolve()
        if path.is_file():
            # override=False is the "existing environment wins" rule above.
            load_dotenv(path, override=False)


def require(*names: str) -> None:
    """Fails early and readably when a credential is still missing.

    Called before any real work so a misconfigured run costs a second rather
    than a season of downloaded stats followed by a KeyError.
    """
    load()
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise SystemExit(
            f"Missing required environment variable(s): {', '.join(missing)}.\n"
            f"Locally these are read from nextjs/.env and nextjs/.env.local; "
            f"in CI they come from repository secrets."
        )
