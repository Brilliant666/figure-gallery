"""One candidate-only Python client with Wagtail and Payload adapters."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

try:
    from ..fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture
    from ..network_guard import assert_url_allowed
    from ..synthetic_media import enrich_image_descriptor, png_bytes
except ImportError:  # direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture
    from network_guard import assert_url_allowed
    from synthetic_media import enrich_image_descriptor, png_bytes


Transport = Callable[[Request, float], tuple[int, bytes]]
RUNTIME_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$")

# Candidate endpoints are required to be loopback-only. Use an explicit empty
# proxy map so host/user proxy settings cannot route the runtime token away
# from the local prototype.
_LOOPBACK_OPENER = build_opener(ProxyHandler({}))


class CandidateClientError(RuntimeError):
    """Candidate protocol configuration, transport, or response failure."""


@dataclass(frozen=True)
class Adapter:
    name: str
    default_endpoint: str
    endpoint_env: str
    default_upload_endpoint: str
    upload_endpoint_env: str
    token_env: str
    client_id_env: str
    authorization_template: str

    def authorization_header(self, token: str) -> str:
        return self.authorization_template.format(token=token)


ADAPTERS: dict[str, Adapter] = {
    "wagtail": Adapter(
        name="wagtail",
        default_endpoint="http://127.0.0.1:8000/api/val02/candidates/upsert/",
        endpoint_env="VAL02_WAGTAIL_CANDIDATE_ENDPOINT",
        default_upload_endpoint="http://127.0.0.1:8000/api/val02b/candidates/media/upload/",
        upload_endpoint_env="VAL02_WAGTAIL_CANDIDATE_UPLOAD_ENDPOINT",
        token_env="VAL02_WAGTAIL_CANDIDATE_TOKEN",
        client_id_env="VAL02_WAGTAIL_CANDIDATE_CLIENT_ID",
        authorization_template="Bearer {token}",
    ),
    "payload": Adapter(
        name="payload",
        default_endpoint="http://127.0.0.1:3000/api/candidate-records/upsert",
        endpoint_env="VAL02_PAYLOAD_CANDIDATE_ENDPOINT",
        default_upload_endpoint="http://127.0.0.1:3000/api/val02b/candidate-media/upload",
        upload_endpoint_env="VAL02_PAYLOAD_CANDIDATE_UPLOAD_ENDPOINT",
        token_env="VAL02_PAYLOAD_CANDIDATE_TOKEN",
        client_id_env="VAL02_PAYLOAD_CANDIDATE_CLIENT_ID",
        authorization_template="users API-Key {token}",
    ),
}


def _assert_loopback_endpoint(endpoint: str) -> None:
    assert_url_allowed(endpoint)
    hostname = urlsplit(endpoint).hostname
    if hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise CandidateClientError("VAL-02 candidate endpoints must be loopback-only")


def _validate_runtime_identifier(label: str, value: str) -> str:
    if not isinstance(value, str) or RUNTIME_ID_PATTERN.fullmatch(value) is None:
        raise CandidateClientError(
            f"{label} must contain 1 to 128 safe identifier characters"
        )
    return value


def prepare_candidate_envelope(candidate: dict[str, Any]) -> dict[str, Any]:
    """Create the only operation this client can send: candidate_upsert."""

    if not isinstance(candidate, dict):
        raise CandidateClientError("candidate must be an object")
    required = {"id", "source", "raw_title", "raw_character_names", "raw_manufacturer", "status", "images"}
    missing = sorted(required - candidate.keys())
    if missing:
        raise CandidateClientError(f"candidate is missing required fields: {missing}")
    source = candidate["source"]
    if not isinstance(source, dict) or not source.get("source_type"):
        raise CandidateClientError("candidate.source.source_type is required")
    if not source.get("source_item_id") and not source.get("source_url"):
        raise CandidateClientError("candidate source needs source_item_id or source_url")
    if not isinstance(candidate["images"], list):
        raise CandidateClientError("candidate.images must be an array")
    prepared = copy.deepcopy(candidate)
    prepared["images"] = [enrich_image_descriptor(image) for image in prepared["images"]]
    for image in prepared["images"]:
        if "content_base64" in image or "bytes" in image:
            raise CandidateClientError("candidate protocol must not embed image binary data")
    return {"protocol_version": 1, "operation": "candidate_upsert", "candidate": prepared}


def prepare_candidate_media_upload(
    *,
    client_id: str,
    candidate_id: str,
    client_candidate_id: str,
    image: dict[str, Any],
    idempotency_key: str | None = None,
    filename: str | None = None,
) -> tuple[dict[str, Any], bytes]:
    """Create runtime PNG bytes and the metadata part for one candidate upload."""

    for label, value in {
        "client_id": client_id,
        "candidate_id": candidate_id,
        "client_candidate_id": client_candidate_id,
    }.items():
        _validate_runtime_identifier(label, value)
    if not isinstance(image, dict) or not isinstance(image.get("generator"), dict):
        raise CandidateClientError("image.generator is required for synthetic upload")
    try:
        generator = image["generator"]
        binary = png_bytes(generator["width"], generator["height"], generator["rgba"])
        descriptor = enrich_image_descriptor(image)
    except (KeyError, TypeError, ValueError) as exc:
        raise CandidateClientError(f"invalid synthetic image generator: {exc}") from exc
    upload_filename = filename or f"{image.get('id', 'synthetic-candidate')}.png"
    if not isinstance(upload_filename, str) or not 1 <= len(upload_filename) <= 200:
        raise CandidateClientError("filename must contain 1 to 200 characters")
    if any(ord(character) < 32 for character in upload_filename) or any(
        character in upload_filename for character in ('"', '/', '\\')
    ):
        raise CandidateClientError("filename contains an unsafe character")
    digest = hashlib.sha256(binary).hexdigest()
    if idempotency_key is None:
        idempotency_key = hashlib.sha256(
            f"{client_id}\0{client_candidate_id}\0{digest}".encode("utf-8")
        ).hexdigest()
    if not isinstance(idempotency_key, str) or IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key) is None:
        raise CandidateClientError(
            "idempotency_key must contain 16 to 200 safe identifier characters"
        )
    metadata = {
        "protocol_version": 2,
        "operation": "candidate_media_upload",
        "client_id": client_id,
        "candidate_id": candidate_id,
        "client_candidate_id": client_candidate_id,
        "idempotency_key": idempotency_key,
        "filename": upload_filename,
        "content_type": "image/png",
        "width": descriptor["width"],
        "height": descriptor["height"],
        "file_size": len(binary),
        "sha256": digest,
        "perceptual_hash": descriptor["perceptual_hash"],
    }
    return metadata, binary


def _multipart_body(metadata: dict[str, Any], binary: bytes) -> tuple[str, bytes]:
    boundary = f"figure-gallery-val02b-{uuid.uuid4().hex}"
    metadata_bytes = json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    filename = metadata["filename"]
    body = b"".join(
        (
            f"--{boundary}\r\n".encode("ascii"),
            b'Content-Disposition: form-data; name="metadata"\r\n',
            b"Content-Type: application/json; charset=utf-8\r\n\r\n",
            metadata_bytes,
            b"\r\n",
            f"--{boundary}\r\n".encode("ascii"),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"),
            b"Content-Type: image/png\r\n\r\n",
            binary,
            b"\r\n",
            f"--{boundary}--\r\n".encode("ascii"),
        )
    )
    return boundary, body


def _stdlib_transport(request: Request, timeout: float) -> tuple[int, bytes]:
    try:
        with _LOOPBACK_OPENER.open(request, timeout=timeout) as response:
            return int(response.status), response.read()
    except HTTPError as exc:
        return int(exc.code), exc.read()
    except URLError as exc:
        raise CandidateClientError(f"candidate endpoint transport failed: {exc.reason}") from exc


class CandidateClient:
    """Local HTTP client whose public surface has no formal-entity write method."""

    def __init__(self, *args: Any, **kwargs: Any):
        raise CandidateClientError("use from_environment(); credentials may only come from runtime environment variables")

    @classmethod
    def from_environment(cls, adapter_name: str, transport: Transport = _stdlib_transport) -> "CandidateClient":
        try:
            adapter = ADAPTERS[adapter_name]
        except KeyError as exc:
            raise CandidateClientError(f"unknown adapter {adapter_name!r}") from exc
        token = os.environ.get(adapter.token_env)
        if not token:
            raise CandidateClientError(f"runtime environment variable {adapter.token_env} is required")
        endpoint = os.environ.get(adapter.endpoint_env, adapter.default_endpoint)
        _assert_loopback_endpoint(endpoint)
        upload_endpoint = os.environ.get(adapter.upload_endpoint_env, adapter.default_upload_endpoint)
        _assert_loopback_endpoint(upload_endpoint)
        instance = object.__new__(cls)
        instance._adapter = adapter
        instance._endpoint = endpoint
        instance._upload_endpoint = upload_endpoint
        client_id = os.environ.get(adapter.client_id_env)
        instance._client_id = (
            _validate_runtime_identifier(adapter.client_id_env, client_id)
            if client_id is not None
            else None
        )
        instance._authorization = adapter.authorization_header(token)
        instance._transport = transport
        return instance

    @property
    def adapter_name(self) -> str:
        return self._adapter.name

    def upsert_candidate(self, candidate: dict[str, Any], timeout: float = 10.0) -> dict[str, Any]:
        envelope = prepare_candidate_envelope(candidate)
        payload = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Authorization": self._authorization,
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "figure-gallery-val02-candidate-client/1",
        }
        if self._client_id:
            headers["X-Candidate-Client-Id"] = self._client_id
        request = Request(
            self._endpoint,
            data=payload,
            method="POST",
            headers=headers,
        )
        status, body = self._transport(request, timeout)
        if status < 200 or status >= 300:
            raise CandidateClientError(f"candidate endpoint rejected request with HTTP {status}")
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CandidateClientError("candidate endpoint returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise CandidateClientError("candidate endpoint response must be an object")
        return parsed

    def upsert_candidates(self, candidates: list[dict[str, Any]], timeout: float = 10.0) -> list[dict[str, Any]]:
        return [self.upsert_candidate(candidate, timeout=timeout) for candidate in candidates]

    def upload_candidate_image(
        self,
        *,
        candidate_id: str,
        client_candidate_id: str,
        image: dict[str, Any],
        idempotency_key: str | None = None,
        filename: str | None = None,
        timeout: float = 10.0,
    ) -> dict[str, Any]:
        """Upload one generated PNG; this surface cannot write formal media or main images."""

        if not self._client_id:
            raise CandidateClientError(
                f"runtime environment variable {self._adapter.client_id_env} is required for media upload"
            )
        metadata, binary = prepare_candidate_media_upload(
            client_id=self._client_id,
            candidate_id=candidate_id,
            client_candidate_id=client_candidate_id,
            image=image,
            idempotency_key=idempotency_key,
            filename=filename,
        )
        boundary, body = _multipart_body(metadata, binary)
        request = Request(
            self._upload_endpoint,
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Authorization": self._authorization,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Idempotency-Key": metadata["idempotency_key"],
                "X-Candidate-Client-Id": self._client_id,
                "User-Agent": "figure-gallery-val02b-candidate-client/2",
            },
        )
        status, response_body = self._transport(request, timeout)
        if status < 200 or status >= 300:
            raise CandidateClientError(f"candidate media endpoint rejected request with HTTP {status}")
        try:
            parsed = json.loads(response_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CandidateClientError("candidate media endpoint returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise CandidateClientError("candidate media endpoint response must be an object")
        return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", choices=sorted(ADAPTERS), required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--candidate-id", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true", help="Validate and print metadata only; never read a token or open a socket")
    parser.add_argument(
        "--dry-run-upload",
        action="store_true",
        help="Build synthetic multipart upload summaries; never read a token, write a PNG, or open a socket",
    )
    args = parser.parse_args()

    fixture = load_fixture(args.fixture)
    candidates = fixture["candidate_records"]
    if args.candidate_id:
        wanted = set(args.candidate_id)
        candidates = [item for item in candidates if item["id"] in wanted]
        missing = sorted(wanted - {item["id"] for item in candidates})
        if missing:
            raise CandidateClientError(f"unknown candidate ids: {missing}")

    if args.dry_run and args.dry_run_upload:
        raise CandidateClientError("choose only one dry-run mode")

    if args.dry_run_upload:
        requests = []
        for candidate in candidates:
            for image in candidate["images"]:
                metadata, binary = prepare_candidate_media_upload(
                    client_id="dry-run-client",
                    candidate_id=candidate["id"],
                    client_candidate_id=candidate["id"],
                    image=image,
                )
                boundary, body = _multipart_body(metadata, binary)
                requests.append(
                    {
                        "candidate_id": candidate["id"],
                        "operation": metadata["operation"],
                        "filename": metadata["filename"],
                        "file_size": metadata["file_size"],
                        "sha256": metadata["sha256"],
                        "perceptual_hash": metadata["perceptual_hash"],
                        "multipart_content_type": f"multipart/form-data; boundary={boundary}",
                        "multipart_size": len(body),
                        "contains_binary_part": body.count(binary) == 1,
                    }
                )
        print(
            json.dumps(
                {"adapter": args.adapter, "dry_run_upload": True, "requests": requests},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.dry_run:
        envelopes = [prepare_candidate_envelope(candidate) for candidate in candidates]
        summary = [
            {
                "candidate_id": envelope["candidate"]["id"],
                "operation": envelope["operation"],
                "image_count": len(envelope["candidate"]["images"]),
                "contains_binary": any("content_base64" in image or "bytes" in image for image in envelope["candidate"]["images"]),
            }
            for envelope in envelopes
        ]
        print(json.dumps({"adapter": args.adapter, "dry_run": True, "requests": summary}, ensure_ascii=False, indent=2))
        return 0

    client = CandidateClient.from_environment(args.adapter)
    print(json.dumps(client.upsert_candidates(candidates), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
