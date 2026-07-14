"""Framework-neutral synthetic candidate upload cases for VAL-02B."""

from __future__ import annotations

import binascii
import hashlib
import struct
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

try:
    from .synthetic_media import PNG_SIGNATURE, average_hash, png_bytes
except ImportError:  # direct script execution
    from synthetic_media import PNG_SIGNATURE, average_hash, png_bytes


MAX_TEST_IMAGE_BYTES = 64 * 1024
PNG_CONTENT_TYPE = "image/png"


@dataclass(frozen=True)
class CandidateMediaCase:
    """Runtime-only upload input; callers must not persist ``content`` in Git."""

    case_id: str
    filename: str
    declared_content_type: str
    content: bytes
    expected: str
    expected_error: str | None = None
    width: int | None = None
    height: int | None = None
    perceptual_hash: str | None = None
    source_url: str | None = None

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()

    @property
    def file_size(self) -> int:
        return len(self.content)

    def safe_manifest(self) -> dict[str, Any]:
        """Return machine evidence without binary or a runtime credential."""

        return {
            "case_id": self.case_id,
            "filename": self.filename,
            "declared_content_type": self.declared_content_type,
            "file_size": self.file_size,
            "sha256": self.sha256,
            "width": self.width,
            "height": self.height,
            "perceptual_hash": self.perceptual_hash,
            "source_url": self.source_url,
            "expected": self.expected,
            "expected_error": self.expected_error,
        }


def synthetic_png_upload_case(
    *,
    case_id: str = "valid-png",
    filename: str = "synthetic-candidate.png",
    width: int = 37,
    height: int = 53,
    rgba: list[int] | None = None,
    source_url: str = "https://synthetic-media.invalid/candidate.png",
) -> CandidateMediaCase:
    rgba = rgba or [63, 127, 191, 255]
    parsed_source = urlsplit(source_url)
    if parsed_source.scheme != "https" or not parsed_source.hostname:
        raise ValueError("synthetic source_url must be an absolute HTTPS URL")
    return CandidateMediaCase(
        case_id=case_id,
        filename=filename,
        declared_content_type=PNG_CONTENT_TYPE,
        content=png_bytes(width, height, rgba),
        expected="accept",
        width=width,
        height=height,
        perceptual_hash=average_hash(width, height, rgba),
        source_url=source_url,
    )


def invalid_text_upload_case() -> CandidateMediaCase:
    return CandidateMediaCase(
        case_id="non-image-text",
        filename="not-an-image.txt",
        declared_content_type="text/plain",
        content=b"synthetic text is not an image\n",
        expected="reject",
        expected_error="unsupported_media_type",
    )


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = binascii.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def oversize_png_upload_case(max_bytes: int = MAX_TEST_IMAGE_BYTES) -> CandidateMediaCase:
    """Build a valid PNG exceeding ``max_bytes`` using a harmless text chunk."""

    base = png_bytes(8, 8, [91, 143, 211, 255])
    content = base[:-12] + _png_chunk(b"tEXt", b"synthetic\0" + b"x" * max_bytes) + base[-12:]
    if len(content) <= max_bytes:  # defensive if the PNG implementation changes
        raise AssertionError("oversize synthetic PNG did not exceed the configured limit")
    return CandidateMediaCase(
        case_id="oversize-image",
        filename="oversize-synthetic.png",
        declared_content_type=PNG_CONTENT_TYPE,
        content=content,
        expected="reject",
        expected_error="file_too_large",
        width=8,
        height=8,
        perceptual_hash=average_hash(8, 8, [91, 143, 211, 255]),
    )


def mismatched_type_upload_case() -> CandidateMediaCase:
    valid = synthetic_png_upload_case(case_id="mismatched-content-type")
    return CandidateMediaCase(
        case_id=valid.case_id,
        filename="synthetic-with-wrong-type.png",
        declared_content_type="text/plain",
        content=valid.content,
        expected="reject",
        expected_error="content_type_mismatch",
        width=valid.width,
        height=valid.height,
        perceptual_hash=valid.perceptual_hash,
    )


def shared_rejection_cases() -> tuple[CandidateMediaCase, ...]:
    return (
        invalid_text_upload_case(),
        oversize_png_upload_case(),
        mismatched_type_upload_case(),
    )


def content_identity_cases() -> tuple[CandidateMediaCase, CandidateMediaCase, CandidateMediaCase]:
    """Return same-content/different-provenance and changed-content/same-URL cases."""

    original = synthetic_png_upload_case(
        case_id="content-original",
        filename="original-synthetic.png",
        source_url="https://synthetic-a.invalid/reference.png",
    )
    renamed = CandidateMediaCase(
        case_id="content-renamed",
        filename="renamed-synthetic.png",
        declared_content_type=original.declared_content_type,
        content=original.content,
        expected="accept",
        width=original.width,
        height=original.height,
        perceptual_hash=original.perceptual_hash,
        source_url="https://synthetic-b.invalid/renamed.png",
    )
    changed = synthetic_png_upload_case(
        case_id="content-changed",
        filename=original.filename,
        rgba=[191, 63, 127, 255],
        source_url=original.source_url or "https://synthetic-a.invalid/reference.png",
    )
    return original, renamed, changed


def png_dimensions(content: bytes) -> tuple[int, int]:
    if len(content) < 24 or not content.startswith(PNG_SIGNATURE) or content[12:16] != b"IHDR":
        raise ValueError("content is not a PNG with an IHDR header")
    return struct.unpack(">II", content[16:24])
