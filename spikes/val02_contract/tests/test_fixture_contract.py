from __future__ import annotations

import copy
import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from fixture_contract import (  # noqa: E402
    DEFAULT_FIXTURE_PATH,
    FixtureValidationError,
    fixture_sha256,
    load_fixture,
    validate_fixture,
)
from synthetic_media import (  # noqa: E402
    PNG_SIGNATURE,
    enrich_image_descriptor,
    materialize_fixture_images,
    png_bytes,
)


class FixtureContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture()

    def test_full_fixture_integrity(self) -> None:
        counts = validate_fixture(self.fixture, DEFAULT_FIXTURE_PATH.parent)
        self.assertEqual(counts["works"], 2)
        self.assertEqual(counts["characters"], 4)
        self.assertEqual(counts["manufacturers"], 3)
        self.assertEqual(counts["figure_prototypes"], 5)
        self.assertEqual(counts["candidate_records"], 4)
        self.assertEqual(counts["image_descriptors"], 11)

    def test_fixture_digest_is_canonical_file_digest(self) -> None:
        self.assertEqual(fixture_sha256(), hashlib.sha256(DEFAULT_FIXTURE_PATH.read_bytes()).hexdigest())

    def test_every_candidate_has_multiple_dynamic_images(self) -> None:
        for candidate in self.fixture["candidate_records"]:
            self.assertGreaterEqual(len(candidate["images"]), 2, candidate["id"])
            self.assertTrue(all(image["generator"] and image["format"] == "PNG" for image in candidate["images"]))

    def test_adult_main_image_and_attack_scenarios_are_explicit(self) -> None:
        self.assertTrue(
            any(image["is_adult"] for row in self.fixture["candidate_records"] for image in row["images"])
        )
        prototypes = {row["id"]: row for row in self.fixture["figure_prototypes"]}
        candidates = {row["id"]: row for row in self.fixture["candidate_records"]}
        scenarios = self.fixture["scenarios"]
        protected = prototypes[scenarios["protected_main_image_prototype_id"]]
        attack = candidates[scenarios["protected_main_image_candidate_id"]]
        self.assertIsNotNone(protected["main_image_id"])
        self.assertNotEqual(attack["requested_changes"]["main_image_id"], protected["main_image_id"])
        self.assertIn("main_image_id", attack["expected_rejections"])

    def test_fixture_contains_no_real_source_host_or_binary(self) -> None:
        rendered = DEFAULT_FIXTURE_PATH.read_text(encoding="utf-8").lower()
        forbidden_root = "h" + "poi.net"
        self.assertNotIn(forbidden_root, rendered)
        binary_suffixes = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"}
        self.assertFalse(
            [path for path in DEFAULT_FIXTURE_PATH.parent.rglob("*") if path.is_file() and path.suffix.lower() in binary_suffixes]
        )

    def test_mutation_missing_same_name_disambiguation_is_rejected(self) -> None:
        fixture = copy.deepcopy(self.fixture)
        fixture["characters"][1]["display_name"] = "月林"
        with self.assertRaisesRegex(FixtureValidationError, "same-name"):
            validate_fixture(fixture)

    def test_mutation_single_candidate_image_is_rejected(self) -> None:
        fixture = copy.deepcopy(self.fixture)
        fixture["candidate_records"][0]["images"] = fixture["candidate_records"][0]["images"][:1]
        with self.assertRaisesRegex(FixtureValidationError, "multiple images"):
            validate_fixture(fixture)

    def test_mutation_draft_manufacturer_on_formal_prototype_is_rejected(self) -> None:
        fixture = copy.deepcopy(self.fixture)
        fixture["figure_prototypes"][0]["manufacturer_id"] = "manufacturer-sketch"
        with self.assertRaisesRegex(FixtureValidationError, "draft manufacturer"):
            validate_fixture(fixture)

    def test_dynamic_png_has_expected_signature_and_dimensions(self) -> None:
        binary = png_bytes(17, 23, [10, 20, 30, 255])
        self.assertTrue(binary.startswith(PNG_SIGNATURE))
        self.assertEqual(struct.unpack(">II", binary[16:24]), (17, 23))

    def test_enriched_image_has_hashes_but_no_binary(self) -> None:
        image = self.fixture["candidate_records"][0]["images"][0]
        enriched = enrich_image_descriptor(image)
        self.assertRegex(enriched["sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(enriched["perceptual_hash"], r"^[0-9a-f]{16}$")
        self.assertGreater(enriched["file_size"], 0)
        self.assertNotIn("content_base64", enriched)
        self.assertNotIn("bytes", enriched)
        json.dumps(enriched)

    def test_materialized_pngs_only_exist_in_temp_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            manifest = materialize_fixture_images(self.fixture, output)
            self.assertEqual(len(manifest), 11)
            self.assertEqual(len(list(output.glob("*.png"))), 11)

    def test_materialization_inside_repository_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            materialize_fixture_images(self.fixture, CONTRACT_DIR / "generated-media")


if __name__ == "__main__":
    unittest.main()
