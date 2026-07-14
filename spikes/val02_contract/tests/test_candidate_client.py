from __future__ import annotations

import json
import os
import subprocess
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
    _multipart_body,
    _stdlib_transport,
    prepare_candidate_envelope,
    prepare_candidate_media_upload,
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
        self.assertEqual(
            public,
            {
                "adapter_name",
                "from_environment",
                "upload_candidate_image",
                "upsert_candidate",
                "upsert_candidates",
            },
        )
        forbidden_terms = {"prototype", "character", "manufacturer", "version", "main_image"}
        self.assertFalse(public & forbidden_terms)

    def test_media_upload_requires_runtime_client_identity(self) -> None:
        transport = CapturingTransport()
        with patch.dict(os.environ, {"VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-test-value"}, clear=True):
            client = CandidateClient.from_environment("wagtail", transport)
            with self.assertRaisesRegex(CandidateClientError, "CANDIDATE_CLIENT_ID"):
                client.upload_candidate_image(
                    candidate_id=self.candidate["id"],
                    client_candidate_id="client-row-001",
                    image=self.candidate["images"][0],
                )
        self.assertEqual(transport.requests, [])

    def test_media_upload_is_multipart_with_runtime_identity_and_synthetic_png(self) -> None:
        transport = CapturingTransport(body=b'{"outcome":"new","media_id":"media-1"}')
        environment = {
            "VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-secret-not-in-body",
            "VAL02_WAGTAIL_CANDIDATE_CLIENT_ID": "client-a",
        }
        with patch.dict(os.environ, environment, clear=True):
            client = CandidateClient.from_environment("wagtail", transport)
            result = client.upload_candidate_image(
                candidate_id=self.candidate["id"],
                client_candidate_id="client-row-001",
                image=self.candidate["images"][0],
                idempotency_key="idem-client-row-001",
                filename="renamed-synthetic.png",
            )
        self.assertEqual(result["media_id"], "media-1")
        request, timeout = transport.requests[0]
        self.assertEqual(request.full_url, ADAPTERS["wagtail"].default_upload_endpoint)
        self.assertEqual(request.get_header("X-candidate-client-id"), "client-a")
        self.assertEqual(request.get_header("Idempotency-key"), "idem-client-row-001")
        self.assertIn("multipart/form-data; boundary=", request.get_header("Content-type"))
        self.assertIn(b'form-data; name="metadata"', request.data)
        self.assertIn(b'form-data; name="file"; filename="renamed-synthetic.png"', request.data)
        self.assertIn(b"\x89PNG\r\n\x1a\n", request.data)
        self.assertNotIn(b"runtime-secret-not-in-body", request.data)
        self.assertEqual(timeout, 10.0)

    def test_media_metadata_has_stable_content_identity_when_filename_changes(self) -> None:
        image = self.candidate["images"][0]
        first, first_binary = prepare_candidate_media_upload(
            client_id="client-a",
            candidate_id=self.candidate["id"],
            client_candidate_id="client-row-001",
            image=image,
            filename="first.png",
        )
        second, second_binary = prepare_candidate_media_upload(
            client_id="client-a",
            candidate_id=self.candidate["id"],
            client_candidate_id="client-row-001",
            image=image,
            filename="second.png",
        )
        self.assertEqual(first_binary, second_binary)
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["perceptual_hash"], second["perceptual_hash"])
        self.assertEqual(first["idempotency_key"], second["idempotency_key"])
        self.assertNotEqual(first["filename"], second["filename"])

    def test_multipart_builder_never_serializes_binary_as_base64_or_json(self) -> None:
        metadata, binary = prepare_candidate_media_upload(
            client_id="client-a",
            candidate_id=self.candidate["id"],
            client_candidate_id="client-row-001",
            image=self.candidate["images"][0],
        )
        boundary, body = _multipart_body(metadata, binary)
        self.assertTrue(boundary.startswith("figure-gallery-val02b-"))
        self.assertEqual(body.count(binary), 1)
        self.assertNotIn(b"content_base64", body)
        self.assertNotIn(b'"bytes"', body)

    def test_unsafe_upload_filename_is_rejected(self) -> None:
        with self.assertRaisesRegex(CandidateClientError, "unsafe"):
            prepare_candidate_media_upload(
                client_id="client-a",
                candidate_id=self.candidate["id"],
                client_candidate_id="client-row-001",
                image=self.candidate["images"][0],
                filename="bad\r\nheader.png",
            )

    def test_upload_endpoint_override_must_remain_loopback(self) -> None:
        environment = {
            "VAL02_PAYLOAD_CANDIDATE_TOKEN": "runtime-test-value",
            "VAL02_PAYLOAD_CANDIDATE_CLIENT_ID": "client-a",
            "VAL02_PAYLOAD_CANDIDATE_UPLOAD_ENDPOINT": "https://example.invalid/upload",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(CandidateClientError, "loopback"):
                CandidateClient.from_environment("payload", CapturingTransport())

    def test_upload_failure_does_not_echo_runtime_token(self) -> None:
        transport = CapturingTransport(status=413, body=b'{"error":"too_large"}')
        environment = {
            "VAL02_PAYLOAD_CANDIDATE_TOKEN": "never-echo-this",
            "VAL02_PAYLOAD_CANDIDATE_CLIENT_ID": "client-a",
        }
        with patch.dict(os.environ, environment, clear=True):
            client = CandidateClient.from_environment("payload", transport)
            with self.assertRaisesRegex(CandidateClientError, "HTTP 413") as caught:
                client.upload_candidate_image(
                    candidate_id=self.candidate["id"],
                    client_candidate_id="client-row-001",
                    image=self.candidate["images"][0],
                )
        self.assertNotIn("never-echo-this", str(caught.exception))

    def test_runtime_client_identity_is_header_safe(self) -> None:
        environment = {
            "VAL02_WAGTAIL_CANDIDATE_TOKEN": "runtime-test-value",
            "VAL02_WAGTAIL_CANDIDATE_CLIENT_ID": "client-a\r\nX-Injected: yes",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(CandidateClientError, "safe identifier"):
                CandidateClient.from_environment("wagtail", CapturingTransport())

    def test_idempotency_key_is_header_safe(self) -> None:
        with self.assertRaisesRegex(CandidateClientError, "safe identifier"):
            prepare_candidate_media_upload(
                client_id="client-a",
                candidate_id=self.candidate["id"],
                client_candidate_id="client-row-001",
                image=self.candidate["images"][0],
                idempotency_key="unsafe key with spaces",
            )

    def test_payload_upload_uses_runtime_api_key_and_client_identity(self) -> None:
        transport = CapturingTransport(body=b'{"outcome":"new","media_id":"media-2"}')
        environment = {
            "VAL02_PAYLOAD_CANDIDATE_TOKEN": "payload-runtime-token",
            "VAL02_PAYLOAD_CANDIDATE_CLIENT_ID": "payload-client-a",
        }
        with patch.dict(os.environ, environment, clear=True):
            client = CandidateClient.from_environment("payload", transport)
            client.upload_candidate_image(
                candidate_id=self.candidate["id"],
                client_candidate_id="client-row-001",
                image=self.candidate["images"][0],
            )
        request, _ = transport.requests[0]
        self.assertEqual(request.full_url, ADAPTERS["payload"].default_upload_endpoint)
        self.assertEqual(request.get_header("Authorization"), "users API-Key payload-runtime-token")
        self.assertEqual(request.get_header("X-candidate-client-id"), "payload-client-a")
        self.assertNotIn(b"payload-runtime-token", request.data)

    def test_upload_dry_run_never_needs_credentials_or_writes_media(self) -> None:
        command = [
            sys.executable,
            str(CONTRACT_DIR / "python_candidate_client" / "client.py"),
            "--adapter",
            "wagtail",
            "--candidate-id",
            self.candidate["id"],
            "--dry-run-upload",
        ]
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={key: value for key, value in os.environ.items() if not key.startswith("VAL02_")},
        )
        output = json.loads(completed.stdout)
        self.assertTrue(output["dry_run_upload"])
        self.assertTrue(output["requests"])
        self.assertTrue(all(item["contains_binary_part"] for item in output["requests"]))
        self.assertFalse(any((CONTRACT_DIR / "python_candidate_client").glob("*.png")))

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
