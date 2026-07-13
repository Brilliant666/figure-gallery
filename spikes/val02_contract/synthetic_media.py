"""Create tiny deterministic PNGs for tests and seed operations at runtime."""

from __future__ import annotations

import argparse
import binascii
import hashlib
import json
import struct
import zlib
from pathlib import Path
from typing import Any, Iterable

try:
    from .fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture
except ImportError:  # direct script execution
    from fixture_contract import DEFAULT_FIXTURE_PATH, load_fixture


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunk(kind: bytes, payload: bytes) -> bytes:
    crc = binascii.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def _pixel_rows(width: int, height: int, rgba: list[int]) -> tuple[bytes, list[int]]:
    if not (1 <= width <= 256 and 1 <= height <= 256):
        raise ValueError("synthetic image dimensions must be between 1 and 256")
    if len(rgba) != 4 or any(not isinstance(item, int) or not 0 <= item <= 255 for item in rgba):
        raise ValueError("rgba must contain four integer channels from 0 to 255")
    rows = bytearray()
    grayscale: list[int] = []
    for y in range(height):
        rows.append(0)
        for x in range(width):
            accent = 24 if (x + 2 * y) % 11 == 0 else 0
            r = min(255, rgba[0] + accent)
            g = min(255, rgba[1] + accent // 2)
            b = max(0, rgba[2] - accent // 3)
            rows.extend((r, g, b, rgba[3]))
            grayscale.append((299 * r + 587 * g + 114 * b) // 1000)
    return bytes(rows), grayscale


def png_bytes(width: int, height: int, rgba: list[int]) -> bytes:
    rows, _ = _pixel_rows(width, height, rgba)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return PNG_SIGNATURE + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(rows, 9)) + _chunk(b"IEND", b"")


def average_hash(width: int, height: int, rgba: list[int]) -> str:
    _, grayscale = _pixel_rows(width, height, rgba)
    samples: list[int] = []
    for sample_y in range(8):
        y = min(height - 1, (sample_y * height) // 8)
        for sample_x in range(8):
            x = min(width - 1, (sample_x * width) // 8)
            samples.append(grayscale[y * width + x])
    mean = sum(samples) / len(samples)
    bits = 0
    for value in samples:
        bits = (bits << 1) | int(value >= mean)
    return f"{bits:016x}"


def enrich_image_descriptor(image: dict[str, Any]) -> dict[str, Any]:
    """Return transport-safe image metadata; never embeds image bytes or base64."""

    generator = image["generator"]
    binary = png_bytes(generator["width"], generator["height"], generator["rgba"])
    enriched = dict(image)
    enriched["width"] = generator["width"]
    enriched["height"] = generator["height"]
    enriched["file_size"] = len(binary)
    enriched["sha256"] = hashlib.sha256(binary).hexdigest()
    enriched["perceptual_hash"] = average_hash(generator["width"], generator["height"], generator["rgba"])
    return enriched


def iter_fixture_images(fixture: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield from fixture["media"]
    for candidate in fixture["candidate_records"]:
        yield from candidate["images"]


def materialize_fixture_images(fixture: dict[str, Any], output_dir: Path) -> list[dict[str, Any]]:
    output_dir = output_dir.resolve()
    repository_root = Path(__file__).resolve().parents[2]
    if output_dir == repository_root or repository_root in output_dir.parents:
        raise ValueError("generated media must be written outside the repository")
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    for image in iter_fixture_images(fixture):
        generator = image["generator"]
        binary = png_bytes(generator["width"], generator["height"], generator["rgba"])
        path = output_dir / f"{image['id']}.png"
        path.write_bytes(binary)
        item = enrich_image_descriptor(image)
        item["runtime_path"] = str(path)
        manifest.append(item)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--output-dir", type=Path, required=True, help="Must be outside the repository, e.g. a temp directory")
    args = parser.parse_args()
    manifest = materialize_fixture_images(load_fixture(args.fixture), args.output_dir)
    print(json.dumps({"generated": len(manifest), "images": manifest}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
