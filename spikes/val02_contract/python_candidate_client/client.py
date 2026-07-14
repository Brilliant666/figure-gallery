"""One candidate-only Python client with Wagtail and Payload adapters."""

from __future__ import annotations

import argparse
import copy
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

try:
    from ..fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture
    from ..network_guard import assert_url_allowed
    from ..synthetic_media import enrich_image_descriptor
except ImportError:  # direct script execution
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture
    from network_guard import assert_url_allowed
    from synthetic_media import enrich_image_descriptor


Transport = Callable[[Request, float], tuple[int, bytes]]

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
    token_env: str
    authorization_template: str

    def authorization_header(self, token: str) -> str:
        return self.authorization_template.format(token=token)


ADAPTERS: dict[str, Adapter] = {
    "wagtail": Adapter(
        name="wagtail",
        default_endpoint="http://127.0.0.1:8000/api/val02/candidates/upsert/",
        endpoint_env="VAL02_WAGTAIL_CANDIDATE_ENDPOINT",
        token_env="VAL02_WAGTAIL_CANDIDATE_TOKEN",
        authorization_template="Bearer {token}",
    ),
    "payload": Adapter(
        name="payload",
        default_endpoint="http://127.0.0.1:3000/api/candidate-records/upsert",
        endpoint_env="VAL02_PAYLOAD_CANDIDATE_ENDPOINT",
        token_env="VAL02_PAYLOAD_CANDIDATE_TOKEN",
        authorization_template="users API-Key {token}",
    ),
}


def _assert_loopback_endpoint(endpoint: str) -> None:
    assert_url_allowed(endpoint)
    hostname = urlsplit(endpoint).hostname
    if hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise CandidateClientError("VAL-02 candidate endpoints must be loopback-only")


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
        instance = object.__new__(cls)
        instance._adapter = adapter
        instance._endpoint = endpoint
        instance._authorization = adapter.authorization_header(token)
        instance._transport = transport
        return instance

    @property
    def adapter_name(self) -> str:
        return self._adapter.name

    def upsert_candidate(self, candidate: dict[str, Any], timeout: float = 10.0) -> dict[str, Any]:
        envelope = prepare_candidate_envelope(candidate)
        payload = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = Request(
            self._endpoint,
            data=payload,
            method="POST",
            headers={
                "Accept": "application/json",
                "Authorization": self._authorization,
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "figure-gallery-val02-candidate-client/1",
            },
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", choices=sorted(ADAPTERS), required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--candidate-id", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true", help="Validate and print metadata only; never read a token or open a socket")
    args = parser.parse_args()

    fixture = load_fixture(args.fixture)
    candidates = fixture["candidate_records"]
    if args.candidate_id:
        wanted = set(args.candidate_id)
        candidates = [item for item in candidates if item["id"] in wanted]
        missing = sorted(wanted - {item["id"] for item in candidates})
        if missing:
            raise CandidateClientError(f"unknown candidate ids: {missing}")

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
