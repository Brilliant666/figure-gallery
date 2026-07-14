from __future__ import annotations

import sys
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from candidate_media_contract import (  # noqa: E402
    MAX_TEST_IMAGE_BYTES,
    content_identity_cases,
    invalid_text_upload_case,
    mismatched_type_upload_case,
    oversize_png_upload_case,
    png_dimensions,
    shared_rejection_cases,
    synthetic_png_upload_case,
)
from attack_contract import EXPECTED_ATTACK_IDS, attack_case_map, load_attack_cases  # noqa: E402


class CandidateMediaContractTests(unittest.TestCase):
    def test_valid_case_is_runtime_png_with_hash_dimensions_and_ahash(self) -> None:
        case = synthetic_png_upload_case()
        self.assertEqual(case.expected, "accept")
        self.assertEqual(case.declared_content_type, "image/png")
        self.assertEqual(png_dimensions(case.content), (case.width, case.height))
        self.assertRegex(case.sha256, r"^[0-9a-f]{64}$")
        self.assertRegex(case.perceptual_hash or "", r"^[0-9a-f]{16}$")
        self.assertNotIn("content", case.safe_manifest())

    def test_non_image_text_case_has_deterministic_rejection(self) -> None:
        case = invalid_text_upload_case()
        self.assertEqual(case.expected_error, "unsupported_media_type")
        with self.assertRaisesRegex(ValueError, "not a PNG"):
            png_dimensions(case.content)

    def test_oversize_case_is_a_valid_png_above_shared_limit(self) -> None:
        case = oversize_png_upload_case()
        self.assertGreater(case.file_size, MAX_TEST_IMAGE_BYTES)
        self.assertEqual(png_dimensions(case.content), (8, 8))
        self.assertEqual(case.expected_error, "file_too_large")

    def test_mismatched_type_case_has_png_bytes_but_text_declaration(self) -> None:
        case = mismatched_type_upload_case()
        self.assertEqual(case.declared_content_type, "text/plain")
        self.assertEqual(png_dimensions(case.content), (case.width, case.height))
        self.assertEqual(case.expected_error, "content_type_mismatch")

    def test_shared_rejection_cases_cover_all_required_rejections(self) -> None:
        cases = shared_rejection_cases()
        self.assertEqual(
            {case.expected_error for case in cases},
            {"unsupported_media_type", "file_too_large", "content_type_mismatch"},
        )
        self.assertTrue(all(case.expected == "reject" for case in cases))

    def test_content_identity_cases_cover_url_and_content_changes(self) -> None:
        original, renamed, changed = content_identity_cases()
        self.assertEqual(original.sha256, renamed.sha256)
        self.assertEqual(original.perceptual_hash, renamed.perceptual_hash)
        self.assertNotEqual(original.filename, renamed.filename)
        self.assertNotEqual(original.source_url, renamed.source_url)
        self.assertEqual(original.source_url, changed.source_url)
        self.assertNotEqual(original.sha256, changed.sha256)
        self.assertRegex(changed.perceptual_hash or "", r"^[0-9a-f]{16}$")
        self.assertTrue(all("content" not in item.safe_manifest() for item in (original, renamed, changed)))

    def test_attack_catalog_has_shared_auth_and_media_cases(self) -> None:
        cases = load_attack_cases()
        self.assertEqual(tuple(case.identifier for case in cases), EXPECTED_ATTACK_IDS)
        self.assertEqual(len(cases), 17)
        self.assertTrue(all(case.expected == "reject" for case in cases))
        self.assertEqual(attack_case_map()["AUTH-04"].mapped_gate, "BG-09")
        self.assertEqual(attack_case_map()["UNDO-02"].expected_error, "dependent_operation_conflict")


if __name__ == "__main__":
    unittest.main()
