"""Offline guardrails for the VAL-02 hard network prohibition."""

from __future__ import annotations

import contextlib
import socket
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlsplit


FORBIDDEN_ROOT_HOSTS = frozenset({"hpoi.net"})


class ForbiddenNetworkTarget(RuntimeError):
    """Raised before resolution or transport to a prohibited host."""


def normalized_hostname(hostname: str) -> str:
    return hostname.strip().rstrip(".").lower().encode("idna").decode("ascii")


def is_forbidden_hostname(hostname: str) -> bool:
    host = normalized_hostname(hostname)
    return any(host == root or host.endswith("." + root) for root in FORBIDDEN_ROOT_HOSTS)


def assert_hostname_allowed(hostname: str) -> None:
    if is_forbidden_hostname(hostname):
        raise ForbiddenNetworkTarget(f"VAL-02 forbids network access to {hostname!r}")


def assert_url_allowed(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("endpoint must be an absolute HTTP(S) URL")
    assert_hostname_allowed(parsed.hostname)


@contextlib.contextmanager
def block_forbidden_dns() -> Iterator[None]:
    """Patch DNS resolution so a prohibited hostname fails before any socket I/O."""

    original = socket.getaddrinfo

    def guarded_getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(host, str):
            assert_hostname_allowed(host)
        return original(host, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo
    try:
        yield
    finally:
        socket.getaddrinfo = original
