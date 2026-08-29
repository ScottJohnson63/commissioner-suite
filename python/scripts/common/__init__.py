"""Shared helpers for the scheduled sync scripts in python/scripts.

Scripts are run as `python scripts/<name>.py` from the `python/` directory, which
puts `python/scripts` on sys.path — so `from common import turso` resolves.
"""
