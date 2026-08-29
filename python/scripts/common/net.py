"""Shared guard for outbound HTTP.

urllib.request.urlopen honours whatever scheme it is handed, including file://
and ftp://. Every URL these scripts open is built from a constant or an
environment variable rather than user input, so this is not an injection route
today — but nothing in the code said so, and a mistyped secret would otherwise
turn into a strange request instead of a clear error.

require_https is that missing statement, checked once at the point of use.
"""
from __future__ import annotations

from urllib.parse import urlsplit


def require_https(url: str, *, allowed_host: str | None = None) -> str:
    """Returns `url` unchanged, or raises if it is not plain HTTPS.

    Args:
        url: The absolute URL about to be opened.
        allowed_host: When given, the URL's host must match it exactly. Used
            where the destination is known up front, so a redirected or
            misconfigured base cannot quietly point somewhere else.

    Raises:
        ValueError: If the scheme is not https, the host is missing, or the
            host does not match `allowed_host`.
    """
    parts = urlsplit(url)

    if parts.scheme != "https":
        raise ValueError(
            f"Refusing to open a non-HTTPS URL (scheme {parts.scheme!r}). "
            "Check the configured endpoint."
        )
    if not parts.netloc:
        raise ValueError(f"Refusing to open a URL with no host: {url!r}")
    if allowed_host is not None and parts.hostname != allowed_host:
        raise ValueError(
            f"Refusing to open {parts.hostname!r}; expected {allowed_host!r}."
        )

    return url
