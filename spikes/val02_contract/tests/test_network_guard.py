from __future__ import annotations

import socket
import sys
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from network_guard import (  # noqa: E402
    ForbiddenNetworkTarget,
    assert_url_allowed,
    block_forbidden_dns,
    is_forbidden_hostname,
)


class NetworkGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.forbidden_root = "h" + "poi.net"

    def test_root_and_every_subdomain_are_forbidden(self) -> None:
        self.assertTrue(is_forbidden_hostname(self.forbidden_root))
        self.assertTrue(is_forbidden_hostname("www." + self.forbidden_root))
        self.assertTrue(is_forbidden_hostname("rfx." + self.forbidden_root))
        self.assertTrue(is_forbidden_hostname("nested.any." + self.forbidden_root))
        self.assertTrue(is_forbidden_hostname(("WWW." + self.forbidden_root + ".").upper()))

    def test_lookalike_and_synthetic_hosts_are_not_misclassified(self) -> None:
        self.assertFalse(is_forbidden_hostname("not" + self.forbidden_root))
        self.assertFalse(is_forbidden_hostname("synthetic.invalid"))
        self.assertFalse(is_forbidden_hostname("localhost"))

    def test_forbidden_url_is_rejected_before_transport(self) -> None:
        with self.assertRaises(ForbiddenNetworkTarget):
            assert_url_allowed("https://any." + self.forbidden_root + "/never-requested")

    def test_dns_guard_intercepts_before_real_resolution(self) -> None:
        with block_forbidden_dns():
            with self.assertRaises(ForbiddenNetworkTarget):
                socket.getaddrinfo("www." + self.forbidden_root, 443)

    def test_malformed_endpoint_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            assert_url_allowed("not-an-absolute-url")


if __name__ == "__main__":
    unittest.main()
