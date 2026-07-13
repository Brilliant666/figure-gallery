from __future__ import annotations

import json
import os
import sys
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.request import Request


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from fixture_contract import load_fixture  # noqa: E402
from network_guard import ForbiddenNetworkTarget  # noqa: E402
from python_candidate_client.client import (  # noqa: E402
    ADAPTERS,
    CandidateClient,
    CandidateClientError,
    _stdlib_transport,
    prepare_candidate_envelope,
)


class _LoopbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


class CapturingTransport:
    def __init__(self, status: int = 200, body: bytes = b'{"outcome":"new"}') -> None:
        self.status = status
        self.body = body
        self.requests = []

    def __call__(self, request, timeout: float):
        self.requests.append((request, timeout))
        return self.status, self.body


class CandidateClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture()
        self.candidate = self.fixture["candidate_records"][0]

    def test_stdlib_transport_never_sends_loopback_through_environment_proxy(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), _LoopbackHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        request = Request(f"http://127.0.0.1:{server.server_port}/health")
        try:
            with patch.dict(
                os.environ,
                {"HTTP_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""},
                clear=False,
            ):
                status, body = _stdlib_transport(request, 2.0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True})

    def test_two_adapters_have_distinct_realistic_endpoints(self) -> None:
        self.assertEqual(set(ADAPTERS), {"wagtail", "payload"})
        self.assertEqual(ADAPTERS["wagtail"].default_endpoint, "http://127.0.0.1:8000/api/val02/candidates/upsert/")
        self.assertEqual(ADAPTERS["payload"].default_endpoint, "http://127.0.0.1:3000/api/candidate-records/upsert")

    def test_constructor_cannot_accept_a_token_argument(self) -> None:
        with self.assertRaisesRegex(CandidateClientError, "runtime environment"):
            CandidateClient("wagtail", "token")

    def test_missing_runtime_token_is_rejected(self) -> None:
        adapter = ADAPTERS["wagtail"]
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(CandidateClientError, adapter.token_env):
                CandidateClient.from_environment("wagtail", CapturingTransport())

    def test_wagtail_adapter_sends_candidate_only_protocol(self) -> None:
        transport = CapturingTransport()
        with patch.dict(os.environ, {"VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-test-value"}, clear=True):
            client = CandidateClient.from_environment("wagtail", transport)
            result = client.upsert_candidate(self.candidate)
        self.assertEqual(result, {"outcome": "new"})
        request, timeout = transport.requests[0]
        self.assertEqual(request.full_url, ADAPTERS["wagtail"].default_endpoint)
        self.assertEqual(request.get_header("Authorization"), "Bearer runtime-test-value")
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual(set(body), {"protocol_version", "operation", "candidate"})
        self.assertEqual(body["operation"], "candidate_upsert")
        self.assertEqual(body["candidate"]["id"], self.candidate["id"])
        self.assertEqual(timeout, 10.0)

    def test_payload_adapter_uses_payload_api_key_header(self) -> None:
        transport = CapturingTransport(body=b'{"outcome":"unchanged"}')
        with patch.dict(os.environ, {"VAL02_PAYLOAD_CANDIDATE_TOKEN": "runtime-test-value"}, clear=True):
            client = CandidateClient.from_environment("payload", transport)
            result = client.upsert_candidate(self.candidate)
        request, _ = transport.requests[0]
        self.assertEqual(result, {"outcome": "unchanged"})
        self.assertEqual(request.get_header("Authorization"), "users API-Key runtime-test-value")

    def test_endpoint_override_must_remain_loopback(self) -> None:
        environment = {
            "VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-test-value",
            "VAL02_WAGTAIL_CANDIDATE_ENDPOINT": "https://example.invalid/candidates/upsert",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(CandidateClientError, "loopback"):
                CandidateClient.from_environment("wagtail", CapturingTransport())

    def test_forbidden_host_override_is_rejected_before_transport(self) -> None:
        forbidden = "h" + "poi.net"
        environment = {
            "VAL02_PAYLOAD_CANDIDATE_TOKEN": "runtime-test-value",
            "VAL02_PAYLOAD_CANDIDATE_ENDPOINT": "https://api." + forbidden + "/upsert",
        }
        transport = CapturingTransport()
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(ForbiddenNetworkTarget):
                CandidateClient.from_environment("payload", transport)
        self.assertEqual(transport.requests, [])

    def test_envelope_contains_media_metadata_but_no_binary(self) -> None:
        envelope = prepare_candidate_envelope(self.candidate)
        for image in envelope["candidate"]["images"]:
            self.assertRegex(image["sha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(image["perceptual_hash"], r"^[0-9a-f]{16}$")
            self.assertGreater(image["file_size"], 0)
            self.assertNotIn("bytes", image)
            self.assertNotIn("content_base64", image)

    def test_client_has_no_formal_entity_write_surface(self) -> None:
        public = {name for name in dir(CandidateClient) if not name.startswith("_")}
        self.assertEqual(public, {"adapter_name", "from_environment", "upsert_candidate", "upsert_candidates"})
        forbidden_terms = {"prototype", "character", "manufacturer", "version", "main_image"}
        self.assertFalse(public & forbidden_terms)

    def test_non_success_response_is_rejected_without_echoing_token(self) -> None:
        transport = CapturingTransport(status=403, body=b'{"error":"forbidden"}')
        with patch.dict(os.environ, {"VAL02_WAGTAIL_CANDIDATE_TOKEN": "do-not-echo"}, clear=True):
            client = CandidateClient.from_environment("wagtail", transport)
            with self.assertRaisesRegex(CandidateClientError, "HTTP 403") as caught:
                client.upsert_candidate(self.candidate)
        self.assertNotIn("do-not-echo", str(caught.exception))

    def test_invalid_json_response_is_rejected(self) -> None:
        transport = CapturingTransport(body=b"not-json")
        with patch.dict(os.environ, {"VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-test-value"}, clear=True):
            client = CandidateClient.from_environment("wagtail", transport)
            with self.assertRaisesRegex(CandidateClientError, "invalid JSON"):
                client.upsert_candidate(self.candidate)


if __name__ == "__main__":
    unittest.main()
