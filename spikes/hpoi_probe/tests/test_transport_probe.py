from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import transport_probe  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_URL = "https://www.hpoi.net/hobby/80002"
IMAGE_URL = "https://rfx.hpoi.net/gk/pic/s/sample.jpg?date=1"


class _Clock:
    def __init__(self, start: float = 100.0) -> None:
        self.value = start
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds


class _CookieJar:
    def __init__(self) -> None:
        self.clear_calls = 0

    def clear(self) -> None:
        self.clear_calls += 1


class _Response:
    status_code = 200
    headers = {"Content-Type": "text/html; charset=utf-8"}

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def iter_content(self, chunk_size: int) -> list[bytes]:
        if chunk_size <= 0:  # pragma: no cover - defensive fake assertion
            raise AssertionError("chunk size must be positive")
        return [b"<html>offline fixture</html>"]


class _Session:
    def __init__(self) -> None:
        self.trust_env = True
        self.auth: object = ("unexpected", "credentials")
        self.cookies = _CookieJar()
        self.mount_calls: list[tuple[str, object]] = []
        self.get_calls: list[tuple[str, dict[str, object]]] = []
        self.closed = False

    def mount(self, prefix: str, adapter: object) -> None:
        self.mount_calls.append((prefix, adapter))

    def get(self, url: str, **kwargs: object) -> _Response:
        self.get_calls.append((url, kwargs))
        return _Response()

    def close(self) -> None:
        self.closed = True


class RequestBudgetTests(unittest.TestCase):
    def test_budget_enforces_two_second_spacing_and_thirty_request_cap(self) -> None:
        clock = _Clock()
        with tempfile.TemporaryDirectory() as directory:
            budget = transport_probe.RequestBudget(
                Path(directory) / "budget.json",
                now=clock.now,
                sleep=clock.sleep,
            )
            budget.initialize(initial_count=28)
            with self.assertRaises(FileExistsError):
                budget.initialize(initial_count=0)

            self.assertEqual(budget.acquire(), 29)
            self.assertEqual(budget.acquire(), 30)
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                budget.acquire()

            state = budget.read()

        self.assertEqual(clock.sleeps, [2.0])
        self.assertEqual(state["count"], 30)
        self.assertEqual(state["max_requests"], 30)
        self.assertEqual(state["min_interval_seconds"], 2.0)


class CurlCommandTests(unittest.TestCase):
    def test_direct_command_puts_q_first_and_explicitly_disables_proxy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            command = transport_probe.build_curl_command(
                PRODUCT_URL,
                kind="html",
                proxy=None,
                referer=None,
                timeout=10,
                body_limit=1024,
                hop_body=Path(directory) / "body",
                hop_headers=Path(directory) / "headers",
            )

        self.assertEqual(command[:2], ["curl.exe", "-q"])
        self.assertEqual(command[command.index("--proxy") + 1], "")
        self.assertEqual(command[command.index("--noproxy") + 1], "*")
        self.assertEqual(command[command.index("--max-redirs") + 1], "0")
        self.assertNotIn("--location", command)
        self.assertEqual(command[-1], PRODUCT_URL)

    def test_explicit_proxy_command_uses_only_the_approved_loopback_endpoint(self) -> None:
        proxy = transport_probe.ONLY_ALLOWED_PROXY
        with tempfile.TemporaryDirectory() as directory:
            command = transport_probe.build_curl_command(
                PRODUCT_URL,
                kind="html",
                proxy=transport_probe.validate_proxy(proxy),
                referer=None,
                timeout=10,
                body_limit=1024,
                hop_body=Path(directory) / "body",
                hop_headers=Path(directory) / "headers",
            )

        self.assertEqual(command[command.index("--proxy") + 1], proxy)
        self.assertEqual(command[command.index("--noproxy") + 1], "")

    def test_only_exact_unauthenticated_loopback_proxy_is_allowed(self) -> None:
        self.assertIsNone(transport_probe.validate_proxy(None))
        self.assertEqual(
            transport_probe.validate_proxy("http://127.0.0.1:7897"),
            "http://127.0.0.1:7897",
        )
        rejected = (
            "http://localhost:7897",
            "https://127.0.0.1:7897",
            "http://user:secret@127.0.0.1:7897",
            "http://127.0.0.1:7898",
            "http://127.0.0.1:7897/",
        )
        for proxy in rejected:
            with self.subTest(proxy=proxy), self.assertRaises(ValueError):
                transport_probe.validate_proxy(proxy)


class RequestsClientTests(unittest.TestCase):
    def test_requests_ignores_environment_uses_zero_retries_and_sends_no_cookie(self) -> None:
        session = _Session()
        adapter = object()
        with tempfile.TemporaryDirectory() as directory, mock.patch(
            "requests.Session", return_value=session
        ) as session_factory, mock.patch(
            "requests.adapters.HTTPAdapter", return_value=adapter
        ) as adapter_factory:
            result = transport_probe.request_with_requests(
                PRODUCT_URL,
                kind="html",
                proxy=None,
                referer=None,
                timeout=10,
                body_limit=1024,
                hop_body=Path(directory) / "body.html",
            )

        session_factory.assert_called_once_with()
        adapter_factory.assert_called_once_with(max_retries=0)
        self.assertFalse(session.trust_env)
        self.assertIsNone(session.auth)
        self.assertEqual(session.mount_calls, [("https://", adapter)])
        self.assertEqual(session.cookies.clear_calls, 2)
        self.assertTrue(session.closed)
        self.assertEqual(result["status"], 200)

        requested_url, kwargs = session.get_calls[0]
        self.assertEqual(requested_url, PRODUCT_URL)
        self.assertEqual(kwargs["proxies"], {})
        self.assertFalse(kwargs["allow_redirects"])
        self.assertTrue(kwargs["stream"])
        headers = {key.lower(): value for key, value in kwargs["headers"].items()}
        self.assertNotIn("cookie", headers)
        self.assertNotIn("authorization", headers)
        self.assertNotIn("proxy-authorization", headers)


class RedirectTests(unittest.TestCase):
    @staticmethod
    def _budget(directory: str) -> transport_probe.RequestBudget:
        clock = _Clock()
        budget = transport_probe.RequestBudget(
            Path(directory) / "budget.json",
            now=clock.now,
            sleep=clock.sleep,
        )
        budget.initialize()
        return budget

    def test_each_redirect_hop_consumes_one_budget_slot(self) -> None:
        calls: list[str] = []

        def fake_request(url: str, **kwargs: object) -> dict[str, object]:
            calls.append(url)
            hop_body = kwargs["hop_body"]
            if not isinstance(hop_body, Path):  # pragma: no cover - fake contract
                raise AssertionError("hop_body must be a Path")
            hop_body.write_bytes(b"offline")
            if len(calls) == 1:
                return {
                    "client": "requests",
                    "status": 302,
                    "content_type": "text/html",
                    "location": "/hobby/80003",
                    "error_class": None,
                }
            return {
                "client": "requests",
                "status": 200,
                "content_type": "text/html",
                "location": None,
                "error_class": None,
            }

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            transport_probe, "request_with_requests", side_effect=fake_request
        ):
            budget = self._budget(directory)
            result = transport_probe.fetch_one(
                client="requests",
                url=PRODUCT_URL,
                kind="html",
                proxy=None,
                referer=None,
                timeout=10,
                max_redirects=2,
                budget=budget,
                body_output=Path(directory) / "result.html",
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["request_count_after"], 2)
        self.assertEqual([hop["request_number"] for hop in result["hops"]], [1, 2])
        self.assertEqual(
            calls,
            [PRODUCT_URL, "https://www.hpoi.net/hobby/80003"],
        )

    def test_redirect_limit_stops_before_a_third_request(self) -> None:
        calls: list[str] = []

        def redirect(url: str, **_kwargs: object) -> dict[str, object]:
            calls.append(url)
            return {
                "client": "requests",
                "status": 302,
                "content_type": "text/html",
                "location": f"/hobby/{80002 + len(calls)}",
                "error_class": None,
            }

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            transport_probe, "request_with_requests", side_effect=redirect
        ):
            budget = self._budget(directory)
            result = transport_probe.fetch_one(
                client="requests",
                url=PRODUCT_URL,
                kind="html",
                proxy=None,
                referer=None,
                timeout=10,
                max_redirects=1,
                budget=budget,
                body_output=Path(directory) / "result.html",
            )

        self.assertFalse(result["success"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["request_count_after"], 2)
        self.assertEqual(result["hops"][-1]["error_class"], "redirect_limit")

    def test_failed_request_does_not_report_a_stale_body(self) -> None:
        def fail(_url: str, **_kwargs: object) -> dict[str, object]:
            return {"client": "requests", "error_class": "timeout"}

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            transport_probe, "request_with_requests", side_effect=fail
        ):
            budget = self._budget(directory)
            body = Path(directory) / "result.html"
            body.write_bytes(b"stale")
            result = transport_probe.fetch_one(
                client="requests",
                url=PRODUCT_URL,
                kind="html",
                proxy=None,
                referer=None,
                timeout=10,
                max_redirects=1,
                budget=budget,
                body_output=body,
            )
            self.assertFalse(result["success"])
            self.assertFalse(result["body_saved"])
            self.assertFalse(body.exists())


class ValidationTests(unittest.TestCase):
    def test_live_request_cli_defaults_to_no_site_permission(self) -> None:
        parser = transport_probe._build_parser()
        args = parser.parse_args(
            [
                "request",
                "--budget-state",
                str(Path(tempfile.gettempdir()) / "budget.json"),
                "--result",
                str(Path(tempfile.gettempdir()) / "result.json"),
                "--body-output",
                str(Path(tempfile.gettempdir()) / "body.html"),
                "--client",
                "requests",
                "--kind",
                "html",
                "--url",
                PRODUCT_URL,
            ]
        )
        self.assertFalse(args.written_permission_confirmed)

    def test_url_allowlist_is_scheme_host_port_and_kind_specific(self) -> None:
        self.assertEqual(
            transport_probe.validate_public_url(PRODUCT_URL, "html"), PRODUCT_URL
        )
        self.assertEqual(
            transport_probe.validate_public_url(IMAGE_URL, "image"), IMAGE_URL
        )
        rejected = (
            ("http://www.hpoi.net/hobby/80002", "html"),
            ("https://evil.example/hobby/80002", "html"),
            ("https://www.hpoi.net.evil.example/hobby/80002", "html"),
            ("https://user:secret@www.hpoi.net/hobby/80002", "html"),
            ("https://www.hpoi.net:8443/hobby/80002", "html"),
            ("https://www.hpoi.net/hobby/80002?token=placeholder", "html"),
            (PRODUCT_URL, "image"),
            (IMAGE_URL, "html"),
        )
        for url, kind in rejected:
            with self.subTest(url=url, kind=kind), self.assertRaises(ValueError):
                transport_probe.validate_public_url(url, kind)

    def test_referer_is_only_allowed_for_image_and_must_be_a_product_page(self) -> None:
        self.assertIsNone(transport_probe.validate_referer(None, "image"))
        self.assertEqual(
            transport_probe.validate_referer(PRODUCT_URL, "image"), PRODUCT_URL
        )
        rejected = (
            (PRODUCT_URL, "html"),
            ("https://www.hpoi.net/charactar/35516", "image"),
            ("https://evil.example/hobby/80002", "image"),
            ("http://www.hpoi.net/hobby/80002", "image"),
        )
        for referer, kind in rejected:
            with self.subTest(referer=referer, kind=kind), self.assertRaises(ValueError):
                transport_probe.validate_referer(referer, kind)

    def test_content_type_matching_is_conservative(self) -> None:
        matching = (
            ("html", "text/html; charset=utf-8"),
            ("html", "APPLICATION/XHTML+XML"),
            ("image", "image/jpeg"),
            ("image", "IMAGE/WEBP; q=1"),
            ("text", "text/plain"),
        )
        for kind, content_type in matching:
            with self.subTest(kind=kind, content_type=content_type):
                self.assertTrue(transport_probe.content_type_matches(kind, content_type))

        rejected = (
            ("html", "application/json"),
            ("image", "text/html"),
            ("text", "application/octet-stream"),
            ("html", None),
        )
        for kind, content_type in rejected:
            with self.subTest(kind=kind, content_type=content_type):
                self.assertFalse(transport_probe.content_type_matches(kind, content_type))

    def test_runtime_outputs_are_restricted_to_system_temporary_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            allowed = Path(directory) / "result.json"
            self.assertEqual(
                transport_probe._require_temporary_path(allowed), allowed.resolve()
            )

        forbidden = ROOT / "forbidden-runtime-output.json"
        with self.assertRaises(ValueError):
            transport_probe._require_temporary_path(forbidden)

    def test_fetch_rejects_non_temporary_body_before_any_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            transport_probe, "request_with_requests"
        ) as request:
            budget = transport_probe.RequestBudget(Path(directory) / "budget.json")
            budget.initialize()
            with self.assertRaises(ValueError):
                transport_probe.fetch_one(
                    client="requests",
                    url=PRODUCT_URL,
                    kind="html",
                    proxy=None,
                    referer=None,
                    timeout=10,
                    max_redirects=0,
                    budget=budget,
                    body_output=ROOT / "forbidden-runtime-output.html",
                )

            request.assert_not_called()
            self.assertEqual(budget.read()["count"], 0)


if __name__ == "__main__":
    unittest.main()
