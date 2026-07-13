"""Disposable VAL-01 probe for Hpoi candidate snapshots.

This module intentionally creates candidate snapshots only.  It does not define
or mutate any formal character, figure, manufacturer, or product database.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, OpenerDirector, ProxyHandler, Request, build_opener


VOLATILE_FIELDS = {"collected_at"}
TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_KEYS = {"fbclid", "gclid"}
SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "auth",
    "authorization",
    "key",
    "sig",
    "signature",
    "token",
}
DEFAULT_IMAGE_HOSTS = frozenset({"rfx.hpoi.net"})


def normalize_url(url: str) -> str:
    """Return a stable URL without fragments or common tracking parameters."""

    parsed = urlsplit(url.strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower()
    if scheme not in {"http", "https"} or not hostname:
        raise ValueError(f"absolute URL required: {url!r}")
    if parsed.username or parsed.password:
        raise ValueError("credential-bearing URLs are not allowed")

    host = f"[{hostname}]" if ":" in hostname else hostname
    port = parsed.port
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        host = f"{host}:{port}"

    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        lowered = key.lower()
        if lowered in SENSITIVE_QUERY_KEYS:
            raise ValueError("credential-like query parameters are not allowed")
        if lowered in TRACKING_QUERY_KEYS or lowered.startswith(TRACKING_QUERY_PREFIXES):
            continue
        query.append((key, value))
    query.sort()

    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    return urlunsplit((scheme, host, path, urlencode(query), ""))


def _hpoi_host(hostname: str | None) -> bool:
    host = (hostname or "").lower().rstrip(".")
    return host == "hpoi.net" or host.endswith(".hpoi.net")


def source_key(candidate: dict[str, Any]) -> str:
    """Prefer source type + stable source ID; fall back to normalized URL."""

    source_type = str(candidate.get("source_type") or "").strip().lower()
    if not source_type:
        raise ValueError("source_type is required")

    source_item_id = candidate.get("source_item_id")
    if source_item_id is not None and str(source_item_id).strip():
        return f"{source_type}:id:{str(source_item_id).strip()}"

    source_url = str(candidate.get("source_url") or "").strip()
    if not source_url:
        raise ValueError("source_url is required when source_item_id is absent")
    return f"{source_type}:url:{normalize_url(source_url)}"


def _fallback_source_key(candidate: dict[str, Any]) -> str:
    source_type = str(candidate.get("source_type") or "").strip().lower()
    source_url = str(candidate.get("source_url") or "").strip()
    if not source_type or not source_url:
        raise ValueError("source_type and source_url are required")
    return f"{source_type}:url:{normalize_url(source_url)}"


class _HpoiFragmentParser(HTMLParser):
    """Extract a conservative subset from a small HTML page or fragment."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonical_url: str | None = None
        self.document_title: str | None = None
        self.og_title: str | None = None
        self.og_image: str | None = None
        self.images: list[str] = []
        self.fields: dict[str, str] = {}
        self.json_ld: list[Any] = []
        self._capture: str | None = None
        self._buffer: list[str] = []
        self._pending_label: str | None = None
        self._info_item_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        lowered = tag.lower()

        if lowered == "link" and "canonical" in values.get("rel", "").lower().split():
            self.canonical_url = values.get("href") or self.canonical_url
        elif lowered == "meta":
            name = (values.get("property") or values.get("name") or "").lower()
            if name == "og:title":
                self.og_title = values.get("content") or self.og_title
            elif name == "og:image":
                self.og_image = values.get("content") or self.og_image
        elif lowered == "img" and values.get("src"):
            self.images.append(values["src"])

        classes = set(values.get("class", "").split())
        if lowered == "div" and "hpoi-infoList-item" in classes:
            self._info_item_depth = 1
        elif lowered == "div" and self._info_item_depth:
            self._info_item_depth += 1

        if lowered in {"dt", "dd"}:
            self._capture = lowered
            self._buffer = []
        elif lowered == "title":
            self._capture = "title"
            self._buffer = []
        elif self._info_item_depth and lowered == "span":
            self._capture = "info_label"
            self._buffer = []
        elif self._info_item_depth and lowered == "p":
            self._capture = "info_value"
            self._buffer = []
        elif lowered == "script" and values.get("type", "").lower() == "application/ld+json":
            self._capture = "json_ld"
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if self._capture == "dt" and lowered == "dt":
            self._pending_label = _compact_text("".join(self._buffer))
            self._capture = None
        elif self._capture == "dd" and lowered == "dd":
            value = _compact_text("".join(self._buffer))
            if self._pending_label and value:
                self.fields[self._pending_label] = value
            self._pending_label = None
            self._capture = None
        elif self._capture == "title" and lowered == "title":
            self.document_title = _compact_text("".join(self._buffer)) or self.document_title
            self._capture = None
        elif self._capture == "info_label" and lowered == "span":
            self._pending_label = _compact_text("".join(self._buffer))
            self._capture = None
        elif self._capture == "info_value" and lowered == "p":
            value = _compact_text("".join(self._buffer))
            if self._pending_label and value:
                self.fields[self._pending_label] = value
            self._pending_label = None
            self._capture = None
        elif self._capture == "json_ld" and lowered == "script":
            raw = "".join(self._buffer).strip()
            if raw:
                try:
                    self.json_ld.append(json.loads(raw))
                except json.JSONDecodeError:
                    pass
            self._capture = None
        if lowered == "div" and self._info_item_depth:
            self._info_item_depth -= 1
        self._buffer = [] if self._capture is None else self._buffer


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _split_names(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in re.split(r"[、,，/]", value) if part.strip()]


def _first_json_ld_product(values: Iterable[Any]) -> dict[str, Any]:
    queue = list(values)
    creative_work_fallback: dict[str, Any] | None = None
    while queue:
        current = queue.pop(0)
        if isinstance(current, list):
            queue.extend(current)
        elif isinstance(current, dict):
            raw_types = current.get("@type", [])
            types = {raw_types} if isinstance(raw_types, str) else set(raw_types or [])
            if "Product" in types:
                return current
            if "CreativeWork" in types and creative_work_fallback is None:
                creative_work_fallback = current
            queue.extend(value for value in current.values() if isinstance(value, (dict, list)))
    return creative_work_fallback or {}


def _json_ld_images(value: Any) -> list[str]:
    """Extract image URLs from strings, ImageObjects, or nested lists."""

    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [url for item in value for url in _json_ld_images(item)]
    if isinstance(value, dict):
        for key in ("contentUrl", "url", "thumbnailUrl"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                return [candidate]
    return []


def parse_hpoi_html(
    html: str,
    source_url: str,
    *,
    collected_at: str | None = None,
) -> dict[str, Any]:
    """Parse a small Hpoi HTML sample into a candidate-only record."""

    parser = _HpoiFragmentParser()
    parser.feed(html)

    canonical = urljoin(source_url, parser.canonical_url or source_url)
    normalized_source_url = normalize_url(canonical)
    if not _hpoi_host(urlsplit(normalized_source_url).hostname):
        raise ValueError("canonical URL must remain on an Hpoi domain")
    match = re.search(r"/(?:move/)?hobby/(\d+)(?:/|$)", urlsplit(normalized_source_url).path)
    source_item_id = match.group(1) if match else None
    structured = _first_json_ld_product(parser.json_ld)

    raw_title = (
        parser.fields.get("名称")
        or parser.fields.get("中文名")
        or structured.get("name")
        or parser.og_title
        or parser.document_title
    )
    if not raw_title:
        raise ValueError("no item title found in HTML sample")

    image_values: list[str] = []
    structured_images = _json_ld_images(structured.get("image"))
    for image_url in [parser.og_image, *structured_images, *parser.images]:
        if not image_url:
            continue
        absolute = urljoin(normalized_source_url, str(image_url))
        try:
            normalized_image = normalize_url(absolute)
        except ValueError:
            continue
        if not _hpoi_host(urlsplit(normalized_image).hostname):
            continue
        image_path = urlsplit(normalized_image).path
        if not image_path.startswith(("/gk/cover/", "/gk/pic/")):
            continue
        if normalized_image not in image_values:
            image_values.append(normalized_image)

    raw_html_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
    semantic_snapshot = {
        "canonical_url": normalized_source_url,
        "fields": dict(sorted(parser.fields.items())),
        "images": image_values,
        "json_ld_detected": bool(parser.json_ld),
        "title": str(raw_title),
    }
    semantic_hash = hashlib.sha256(
        json.dumps(semantic_snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "source_type": "hpoi",
        "source_item_id": source_item_id,
        "source_url": normalized_source_url,
        "raw_title": str(raw_title),
        "raw_character_names": _split_names(parser.fields.get("角色")),
        "raw_work_name": parser.fields.get("作品"),
        "raw_manufacturer": parser.fields.get("制作") or parser.fields.get("厂商"),
        "raw_category": parser.fields.get("属性") or parser.fields.get("分类"),
        "raw_scale": parser.fields.get("比例"),
        "raw_release_status": parser.fields.get("状态") or parser.fields.get("发售状态"),
        "raw_release_date": parser.fields.get("出货日") or parser.fields.get("发售日"),
        "homepage_image": image_values[0] if image_values else None,
        "candidate_images": image_values,
        "collected_at": collected_at or datetime.now(timezone.utc).isoformat(),
        "raw_snapshot": {
            "format": "html-fragment",
            "source_html_sha256": raw_html_hash,
            "semantic_sha256": semantic_hash,
            "canonical_url": normalized_source_url,
            "normalized_fields": dict(sorted(parser.fields.items())),
            "json_ld_detected": bool(parser.json_ld),
        },
    }


def _normalized_image_record(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return {"source_url": normalize_url(value)}
    if not isinstance(value, dict) or not value.get("source_url"):
        raise ValueError("candidate image must be a URL or a fingerprint record")
    record = dict(value)
    record["source_url"] = normalize_url(str(record["source_url"]))
    return record


def _perceptual_distance(first: str, second: str) -> int:
    return (int(first, 16) ^ int(second, 16)).bit_count()


def _content_match(before: dict[str, Any], after: dict[str, Any]) -> str | None:
    before_sha = before.get("sha256")
    after_sha = after.get("sha256")
    if before_sha and after_sha and before_sha == after_sha:
        return "exact-bytes"

    before_hash = before.get("average_hash")
    after_hash = after.get("average_hash")
    if before_hash and after_hash and _perceptual_distance(str(before_hash), str(after_hash)) == 0:
        return "same-64-bit-ahash"

    if not (before_sha and after_sha) and before["source_url"] == after["source_url"]:
        return "same-url-without-content-hash"
    return None


def diff_image_records(before_values: Iterable[Any], after_values: Iterable[Any]) -> dict[str, Any]:
    """Compare candidate images by bytes/aHash before treating URLs as identity."""

    before = [_normalized_image_record(value) for value in before_values]
    after = [_normalized_image_record(value) for value in after_values]
    unmatched_after = set(range(len(after)))
    matched_before: set[int] = set()
    same_content_url_changes: list[dict[str, Any]] = []
    same_url_content_changes: list[dict[str, Any]] = []

    for before_index, old in enumerate(before):
        ranked_matches: list[tuple[int, int, str]] = []
        for after_index in unmatched_after:
            new = after[after_index]
            match_type = _content_match(old, new)
            if match_type:
                rank = {
                    "exact-bytes": 0,
                    "same-64-bit-ahash": 1,
                    "same-url-without-content-hash": 2,
                }[match_type]
                ranked_matches.append((rank, after_index, match_type))
        if not ranked_matches:
            continue
        _, after_index, match_type = min(ranked_matches)
        new = after[after_index]
        unmatched_after.remove(after_index)
        matched_before.add(before_index)
        if old["source_url"] != new["source_url"]:
            same_content_url_changes.append(
                {
                    "before": old["source_url"],
                    "after": new["source_url"],
                    "match": match_type,
                }
            )

    unmatched_before = set(range(len(before))) - matched_before
    for before_index in list(unmatched_before):
        old = before[before_index]
        same_url_index = next(
            (
                after_index
                for after_index in unmatched_after
                if after[after_index]["source_url"] == old["source_url"]
            ),
            None,
        )
        if same_url_index is None:
            continue
        same_url_content_changes.append(
            {"before": old, "after": after[same_url_index]}
        )
        unmatched_before.remove(before_index)
        unmatched_after.remove(same_url_index)

    result = {
        "same_content_url_changes": same_content_url_changes,
        "same_url_content_changes": same_url_content_changes,
        "removed": [before[index] for index in sorted(unmatched_before)],
        "added": [after[index] for index in sorted(unmatched_after)],
    }
    return {key: value for key, value in result.items() if value}


def _snapshot_identity(value: Any) -> Any:
    if isinstance(value, dict) and value.get("semantic_sha256"):
        return value["semantic_sha256"]
    return value


def diff_candidate(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Return semantic field differences while ignoring collection timestamps."""

    changes: dict[str, Any] = {}
    for field in sorted(set(before) | set(after)):
        if field in VOLATILE_FIELDS:
            continue
        old_value = before.get(field)
        new_value = after.get(field)
        if field == "candidate_images":
            image_changes = diff_image_records(old_value or [], new_value or [])
            if image_changes:
                changes[field] = image_changes
            continue
        if field == "raw_snapshot":
            old_value = _snapshot_identity(old_value)
            new_value = _snapshot_identity(new_value)
        if old_value != new_value:
            changes[field] = {"before": old_value, "after": new_value}
    return changes


def apply_candidates(state_path: Path, candidates: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Idempotently merge candidate records and persist a small JSON snapshot."""

    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    else:
        state = {"schema_version": 1, "items": {}}
    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise ValueError("unsupported or invalid candidate state")
    items = state.setdefault("items", {})
    if not isinstance(items, dict):
        raise ValueError("candidate state items must be an object")

    summary: dict[str, Any] = {
        "new": [],
        "changed": {},
        "unchanged": [],
        "migrated": {},
    }
    seen_fallback_keys: set[str] = set()
    for candidate in candidates:
        key = source_key(candidate)
        fallback_key = _fallback_source_key(candidate)
        if fallback_key in seen_fallback_keys:
            raise ValueError(f"duplicate source in one candidate batch: {fallback_key}")
        seen_fallback_keys.add(fallback_key)

        if key != fallback_key and key not in items and fallback_key in items:
            items[key] = items.pop(fallback_key)
            summary["migrated"][fallback_key] = key
        previous = items.get(key)
        if previous is None:
            summary["new"].append(key)
        else:
            changes = diff_candidate(previous, candidate)
            if changes:
                summary["changed"][key] = changes
            else:
                summary["unchanged"].append(key)
        items[key] = candidate

    if not summary["migrated"]:
        summary.pop("migrated")

    state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = state_path.with_suffix(state_path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(state_path)
    return summary


@dataclass(frozen=True)
class ImageAnalysis:
    content_type: str | None
    byte_length: int
    sha256: str
    width: int
    height: int
    image_format: str | None
    average_hash: str


def image_fingerprint(source_url: str, analysis: ImageAnalysis) -> dict[str, Any]:
    """Create a small candidate-image record suitable for semantic diffing."""

    return {
        "source_url": normalize_url(source_url),
        "content_type": analysis.content_type,
        "byte_length": analysis.byte_length,
        "sha256": analysis.sha256,
        "width": analysis.width,
        "height": analysis.height,
        "image_format": analysis.image_format,
        "average_hash": analysis.average_hash,
    }


def analyze_image_bytes(
    data: bytes,
    content_type: str | None = None,
    *,
    max_pixels: int = 20_000_000,
) -> ImageAnalysis:
    """Compute file metadata, SHA-256, and a simple 64-bit perceptual aHash."""

    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("Pillow is required for image analysis") from exc

    with Image.open(io.BytesIO(data)) as image:
        width, height = image.size
        if width <= 0 or height <= 0 or width * height > max_pixels:
            raise ValueError("image exceeds configured pixel limit")
        image.load()
        image_format = image.format
        resampling = getattr(Image, "Resampling", Image).LANCZOS
        gray = image.convert("L").resize((8, 8), resampling)
        if hasattr(gray, "get_flattened_data"):
            pixels = list(gray.get_flattened_data())
        else:  # Pillow < 12
            pixels = list(gray.getdata())
        mean = sum(pixels) / len(pixels)
        bits = "".join("1" if pixel >= mean else "0" for pixel in pixels)
        average_hash = f"{int(bits, 2):016x}"

    return ImageAnalysis(
        content_type=content_type,
        byte_length=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        width=width,
        height=height,
        image_format=image_format,
        average_hash=average_hash,
    )


def _validated_image_url(url: str, allowed_hosts: Iterable[str]) -> str:
    normalized = normalize_url(url)
    host = (urlsplit(normalized).hostname or "").lower()
    allowed = {value.lower().rstrip(".") for value in allowed_hosts}
    if host not in allowed:
        raise ValueError(f"image host is not allowlisted: {host}")
    return normalized


class _RestrictedRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_hosts: Iterable[str]) -> None:
        super().__init__()
        self.allowed_hosts = frozenset(allowed_hosts)

    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> Request | None:
        target = _validated_image_url(urljoin(req.full_url, newurl), self.allowed_hosts)
        return super().redirect_request(req, fp, code, msg, headers, target)


def fetch_and_analyze_image(
    url: str,
    *,
    timeout: float = 10.0,
    max_bytes: int = 1_000_000,
    max_pixels: int = 20_000_000,
    allowed_hosts: Iterable[str] = DEFAULT_IMAGE_HOSTS,
) -> ImageAnalysis:
    """Fetch one explicitly supplied public image without cookies or credentials."""

    normalized = _validated_image_url(url, allowed_hosts)
    request = Request(
        normalized,
        headers={
            "Accept": "image/*",
            "User-Agent": "figure-gallery-val-01-probe/1.0 (+read-only)",
        },
        method="GET",
    )
    # Do not inherit environment/system proxies: the disposable probe must not
    # silently route through a credentialed or opaque proxy configuration.
    opener: OpenerDirector = build_opener(
        ProxyHandler({}),
        _RestrictedRedirectHandler(allowed_hosts),
    )
    with opener.open(request, timeout=timeout) as response:
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > max_bytes:
            raise ValueError("image exceeds configured byte limit")
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError("image exceeds configured byte limit")
        return analyze_image_bytes(
            data,
            response.headers.get_content_type(),
            max_pixels=max_pixels,
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--collected-at")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    candidates = [
        parse_hpoi_html(
            input_path.read_text(encoding="utf-8"),
            args.source_url,
            collected_at=args.collected_at,
        )
        for input_path in args.input
    ]
    summary = apply_candidates(args.state, candidates)
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
