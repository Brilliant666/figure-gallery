from __future__ import annotations

import io
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from probe import (  # noqa: E402
    analyze_image_bytes,
    apply_candidates,
    diff_candidate,
    fetch_and_analyze_image,
    image_fingerprint,
    normalize_url,
    parse_hpoi_html,
    source_key,
)


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
COLLECTED_AT = "2026-07-12T00:00:00+00:00"


def _sample(name: str) -> str:
    return (SAMPLES / name).read_text(encoding="utf-8")


def _image_bytes(image_format: str = "PNG", *, inverted: bool = False) -> bytes:
    image = Image.new("RGB", (12, 8))
    for x in range(image.width):
        for y in range(image.height):
            red, green, blue = x * 17, y * 25, (x + y) * 9
            if inverted:
                red, green, blue = 255 - red, 255 - green, 255 - blue
            image.putpixel((x, y), (red, green, blue))
    output = io.BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def _png_bytes() -> bytes:
    return _image_bytes("PNG")


class ProbeTests(unittest.TestCase):
    def test_parse_representative_html(self) -> None:
        candidate = parse_hpoi_html(
            _sample("representative_item.html"),
            "https://www.hpoi.net/hobby/98369",
            collected_at=COLLECTED_AT,
        )
        self.assertEqual(candidate["source_item_id"], "98369")
        self.assertEqual(candidate["raw_title"], "初音未来 feat. Yoneyama Mai")
        self.assertEqual(candidate["raw_character_names"], ["初音未来"])
        self.assertEqual(candidate["raw_manufacturer"], "良笑")
        self.assertEqual(candidate["raw_category"], "女 、 比例人形 、 观感安心")
        self.assertEqual(candidate["raw_scale"], "1/7")
        self.assertEqual(candidate["raw_release_status"], "已出荷")
        self.assertEqual(len(candidate["candidate_images"]), 1)

    def test_json_ld_image_object_and_type_list(self) -> None:
        html = """<html><head>
        <link rel="canonical" href="https://www.hpoi.net/hobby/42">
        <script type="application/ld+json">
        {"@type":["Thing","Product"],"name":"样本", "image":
         {"@type":"ImageObject","contentUrl":"https://rfx.hpoi.net/gk/pic/s/42.jpg"}}
        </script></head></html>"""
        candidate = parse_hpoi_html(html, "https://www.hpoi.net/hobby/42")
        self.assertEqual(candidate["raw_title"], "样本")
        self.assertEqual(
            candidate["candidate_images"],
            ["https://rfx.hpoi.net/gk/pic/s/42.jpg"],
        )

    def test_idempotent_first_second_and_changed_runs(self) -> None:
        first = parse_hpoi_html(
            _sample("representative_item.html"),
            "https://www.hpoi.net/hobby/98369",
            collected_at=COLLECTED_AT,
        )
        changed = parse_hpoi_html(
            _sample("representative_item_changed.html"),
            "https://www.hpoi.net/hobby/98369",
            collected_at="2026-07-13T00:00:00+00:00",
        )
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "snapshot.json"
            first_summary = apply_candidates(state, [first])
            second_summary = apply_candidates(state, [first | {"collected_at": "later"}])
            changed_summary = apply_candidates(state, [changed])

        key = "hpoi:id:98369"
        self.assertEqual(first_summary["new"], [key])
        self.assertEqual(second_summary["unchanged"], [key])
        self.assertEqual(changed_summary["new"], [])
        self.assertIn("raw_release_date", changed_summary["changed"][key])
        self.assertIn("candidate_images", changed_summary["changed"][key])

    def test_source_id_has_priority_over_url_changes(self) -> None:
        one = {
            "source_type": "hpoi",
            "source_item_id": "98369",
            "source_url": "https://www.hpoi.net/hobby/98369?from=one",
        }
        two = one | {"source_url": "https://www.hpoi.net/move/hobby/98369?from=two"}
        self.assertEqual(source_key(one), source_key(two))
        self.assertNotEqual(source_key(one), source_key(one | {"source_type": "other"}))

    def test_url_fallback_migrates_when_stable_id_appears(self) -> None:
        identified = parse_hpoi_html(
            _sample("representative_item.html"),
            "https://www.hpoi.net/hobby/98369",
            collected_at=COLLECTED_AT,
        )
        fallback = identified | {"source_item_id": None}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "snapshot.json"
            first = apply_candidates(state, [fallback])
            second = apply_candidates(state, [identified])
            persisted = json.loads(state.read_text(encoding="utf-8"))

        fallback_key = "hpoi:url:https://www.hpoi.net/hobby/98369"
        stable_key = "hpoi:id:98369"
        self.assertEqual(first["new"], [fallback_key])
        self.assertEqual(second["new"], [])
        self.assertEqual(second["migrated"], {fallback_key: stable_key})
        self.assertEqual(list(persisted["items"]), [stable_key])

    def test_url_fallback_is_normalized(self) -> None:
        one = {
            "source_type": "hpoi",
            "source_item_id": None,
            "source_url": "HTTPS://WWW.HPOI.NET/search/?b=2&utm_source=x&a=1#top",
        }
        two = one | {"source_url": "https://www.hpoi.net/search?a=1&b=2"}
        self.assertEqual(source_key(one), source_key(two))
        self.assertEqual(normalize_url(one["source_url"]), "https://www.hpoi.net/search?a=1&b=2")

    def test_ipv6_and_credential_like_query_handling(self) -> None:
        self.assertEqual(
            normalize_url("https://[::1]:8443/a"),
            "https://[::1]:8443/a",
        )
        with self.assertRaises(ValueError):
            normalize_url("https://example.com/image.jpg?token=secret")

    def test_file_hash_dimensions_format_and_perceptual_hash(self) -> None:
        data = _png_bytes()
        first = analyze_image_bytes(data, "image/png")
        second = analyze_image_bytes(bytes(data), "image/png")
        self.assertEqual(first.sha256, second.sha256)
        self.assertEqual(first.average_hash, second.average_hash)
        self.assertEqual((first.width, first.height), (12, 8))
        self.assertEqual(first.image_format, "PNG")

    def test_perceptual_hash_matches_reencoded_same_pixels(self) -> None:
        png = analyze_image_bytes(_image_bytes("PNG"), "image/png")
        bmp = analyze_image_bytes(_image_bytes("BMP"), "image/bmp")
        self.assertNotEqual(png.sha256, bmp.sha256)
        self.assertEqual(png.average_hash, bmp.average_hash)

    def test_candidate_image_diff_recognizes_same_content_under_new_url(self) -> None:
        png = analyze_image_bytes(_image_bytes("PNG"), "image/png")
        bmp = analyze_image_bytes(_image_bytes("BMP"), "image/bmp")
        before = {
            "candidate_images": [
                image_fingerprint("https://rfx.hpoi.net/old.png", png)
            ]
        }
        after = {
            "candidate_images": [
                image_fingerprint("https://rfx.hpoi.net/new.bmp", bmp)
            ]
        }
        changes = diff_candidate(before, after)["candidate_images"]
        self.assertEqual(changes["same_content_url_changes"][0]["match"], "same-64-bit-ahash")
        self.assertNotIn("added", changes)
        self.assertNotIn("removed", changes)

    def test_candidate_image_diff_detects_changed_bytes_at_same_url(self) -> None:
        first = analyze_image_bytes(_image_bytes(), "image/png")
        changed = analyze_image_bytes(_image_bytes(inverted=True), "image/png")
        url = "https://rfx.hpoi.net/same.png"
        changes = diff_candidate(
            {"candidate_images": [image_fingerprint(url, first)]},
            {"candidate_images": [image_fingerprint(url, changed)]},
        )["candidate_images"]
        self.assertIn("same_url_content_changes", changes)

    def test_same_image_under_two_urls_has_same_hashes(self) -> None:
        data = _png_bytes()
        received_headers: list[dict[str, str]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
                received_headers.append(dict(self.headers.items()))
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, _format: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            allowed = {"127.0.0.1"}
            first = fetch_and_analyze_image(f"{base}/first.png", allowed_hosts=allowed)
            second = fetch_and_analyze_image(f"{base}/renamed.png", allowed_hosts=allowed)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(first.sha256, second.sha256)
        self.assertEqual(first.average_hash, second.average_hash)
        self.assertTrue(received_headers)
        self.assertTrue(all("Cookie" not in headers for headers in received_headers))
        self.assertTrue(all("Authorization" not in headers for headers in received_headers))

    def test_image_byte_limits_with_and_without_content_length(self) -> None:
        data = _png_bytes()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                if self.path == "/declared.png":
                    self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, _format: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            for path in ("declared.png", "streamed.png"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    fetch_and_analyze_image(
                        f"{base}/{path}",
                        max_bytes=8,
                        allowed_hosts={"127.0.0.1"},
                    )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_default_image_host_allowlist_and_pixel_limit(self) -> None:
        with self.assertRaises(ValueError):
            fetch_and_analyze_image("http://127.0.0.1/image.png")
        with self.assertRaises(ValueError):
            analyze_image_bytes(_png_bytes(), max_pixels=10)

    def test_credential_bearing_url_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            normalize_url("https://user:secret@example.com/image.jpg")


if __name__ == "__main__":
    unittest.main()
