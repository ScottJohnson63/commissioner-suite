"""Shared helpers for the scheduled sync scripts in python/scripts.

Scripts are run as `python scripts/<name>.py` from the `python/` directory, which
puts `python/scripts` on sys.path — so `from common import turso` resolves.

Importing this package loads the database credentials from nextjs/.env for local
runs. See common.localenv — it is a no-op in CI, where the secrets are already in
the environment.
"""

from common import localenv as _localenv

_localenv.load()
