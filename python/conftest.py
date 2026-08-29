"""Puts `scripts/` on sys.path so tests import `common.*` the same way the
sync scripts do when run as `python scripts/<name>.py` from this directory."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))

# The turso module reads these at call time, but importing sync scripts at
# collection time should not require real credentials.
os.environ.setdefault("TURSO_DATABASE_URL", "libsql://test.invalid")
os.environ.setdefault("TURSO_AUTH_TOKEN", "test-token")
