"""Small pure-Python reference for candidate-only upsert semantics.

This module is not a product model.  It gives both prototypes executable examples
for source identity, URL-to-ID migration, idempotence, and formal-data isolation.
"""

from __future__ import annotations

import copy
import hashlib
import json
import posixpath
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_NAMES = {"fbclid", "gclid"}


def normalize_source_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source URL must be absolute HTTP(S)")
    host = parsed.hostname.lower().encode("idna").decode("ascii")
    port = parsed.port
    if port and not ((parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443)):
        host = f"{host}:{port}"
    path = posixpath.normpath(parsed.path or "/")
    if parsed.path.endswith("/") and not path.endswith("/"):
        path += "/"
    query = [
        (name, value)
        for name, value in parse_qsl(parsed.query, keep_blank_values=True)
        if name.lower() not in TRACKING_QUERY_NAMES
        and not any(name.lower().startswith(prefix) for prefix in TRACKING_QUERY_PREFIXES)
    ]
    query.sort()
    return urlunsplit((parsed.scheme.lower(), host, path, urlencode(query, doseq=True), ""))


def source_identity(source: dict[str, Any]) -> tuple[str, str]:
    source_type = source.get("source_type")
    if not isinstance(source_type, str) or not source_type:
        raise ValueError("source_type is required")
    source_item_id = source.get("source_item_id")
    if isinstance(source_item_id, str) and source_item_id.strip():
        return (source_type, f"id:{source_item_id.strip()}")
    source_url = source.get("source_url")
    if not isinstance(source_url, str) or not source_url:
        raise ValueError("source_url is required when source_item_id is absent")
    return (source_type, f"url:{normalize_source_url(source_url)}")


def _semantic_digest(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass
class CandidateUpsertResult:
    outcome: str
    identity: tuple[str, str]
    previous_identity: tuple[str, str] | None = None


@dataclass
class ReferenceCandidatePool:
    """In-memory candidate pool with deliberately immutable formal projections."""

    formal_character_ids: frozenset[str]
    formal_manufacturer_ids: frozenset[str]
    formal_prototype_main_images: dict[str, str | None]
    sources: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    candidates: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    source_url_index: dict[tuple[str, str], tuple[str, str]] = field(default_factory=dict)

    @classmethod
    def from_fixture(cls, fixture: dict[str, Any]) -> "ReferenceCandidatePool":
        return cls(
            formal_character_ids=frozenset(row["id"] for row in fixture["characters"]),
            formal_manufacturer_ids=frozenset(row["id"] for row in fixture["manufacturers"]),
            formal_prototype_main_images={row["id"]: row["main_image_id"] for row in fixture["figure_prototypes"]},
        )

    def formal_snapshot(self) -> dict[str, Any]:
        return {
            "characters": sorted(self.formal_character_ids),
            "manufacturers": sorted(self.formal_manufacturer_ids),
            "main_images": dict(sorted(self.formal_prototype_main_images.items())),
        }

    def upsert_candidate(self, candidate: dict[str, Any]) -> CandidateUpsertResult:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("source"), dict):
            raise ValueError("candidate with nested source is required")
        source = copy.deepcopy(candidate["source"])
        identity = source_identity(source)
        source_type = source["source_type"]
        normalized_url = normalize_source_url(source["source_url"])
        url_identity = (source_type, f"url:{normalized_url}")
        previous_identity: tuple[str, str] | None = None

        if identity[1].startswith("id:") and identity not in self.sources:
            fallback_identity = self.source_url_index.get((source_type, normalized_url), url_identity)
            if fallback_identity in self.sources and fallback_identity != identity:
                previous_identity = fallback_identity
                self.sources[identity] = self.sources.pop(fallback_identity)
                if fallback_identity in self.candidates:
                    self.candidates[identity] = self.candidates.pop(fallback_identity)
                for key, current in list(self.source_url_index.items()):
                    if current == fallback_identity:
                        self.source_url_index[key] = identity

        previous_candidate = self.candidates.get(identity)
        previous_digest = _semantic_digest(previous_candidate) if previous_candidate else None
        stored_candidate = copy.deepcopy(candidate)
        stored_candidate["source"]["source_url"] = normalized_url
        self.sources[identity] = copy.deepcopy(stored_candidate["source"])
        self.candidates[identity] = stored_candidate
        self.source_url_index[(source_type, normalized_url)] = identity
        current_digest = _semantic_digest(stored_candidate)

        if previous_identity is not None:
            outcome = "migrated" if previous_digest == current_digest else "migrated_updated"
        elif previous_candidate is None:
            outcome = "new"
        elif previous_digest == current_digest:
            outcome = "unchanged"
        else:
            outcome = "updated"
        return CandidateUpsertResult(outcome=outcome, identity=identity, previous_identity=previous_identity)
