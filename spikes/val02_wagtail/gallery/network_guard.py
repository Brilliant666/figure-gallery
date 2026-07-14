"""Process-local guard that blocks every Hpoi hostname before transport.

The prototype has no outbound feature. This extra assertion makes accidental
requests from tests or future spike code fail before DNS / proxy transport.
"""

from functools import wraps
import socket
from urllib.parse import urlsplit


class HpoiNetworkBlocked(RuntimeError):
    pass


def is_hpoi_hostname(hostname):
    value = str(hostname or "").rstrip(".").lower()
    return value == "hpoi.net" or value.endswith(".hpoi.net")


def reject_hpoi_hostname(hostname):
    if is_hpoi_hostname(hostname):
        raise HpoiNetworkBlocked("VAL-02 forbids all Hpoi network access")


_INSTALLED = False
_ORIGINAL_GETADDRINFO = socket.getaddrinfo


def install_hpoi_guard():
    global _INSTALLED
    if _INSTALLED:
        return

    @wraps(_ORIGINAL_GETADDRINFO)
    def guarded_getaddrinfo(host, *args, **kwargs):
        reject_hpoi_hostname(host)
        return _ORIGINAL_GETADDRINFO(host, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo

    try:
        import requests.sessions

        original_request = requests.sessions.Session.request

        @wraps(original_request)
        def guarded_request(session, method, url, *args, **kwargs):
            reject_hpoi_hostname(urlsplit(str(url)).hostname)
            return original_request(session, method, url, *args, **kwargs)

        requests.sessions.Session.request = guarded_request
    except ImportError:
        pass

    _INSTALLED = True
