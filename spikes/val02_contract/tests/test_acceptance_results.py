from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from acceptance_result import AcceptanceRecorder, acceptance_ids  # noqa: E402
from validate_results import ResultValidationError, validate_pair, validate_result_document  # noqa: E402


class AcceptanceResultTests(unittest.TestCase):
    def _document(self, prototype: str, source_file: Path, statuses: dict[str, str] | None = None):
        source_file = Path(__file__)
        recorder = AcceptanceRecorder.from_source_files(
            prototype=prototype,
            runner="unittest-acceptance-runner",
            command=f"python -m {prototype}.tests --emit-acceptance",
            source_files=[source_file],
            runtime={"language": "test-runtime"},
            security={"network_guard": "enabled"},
        )
        statuses = statuses or {}
        for index, identifier in enumerate(acceptance_ids(), start=1):
            status = statuses.get(identifier, "pass")
            kind = "network_guard_test" if identifier == "AC-30" else ("blocker" if status == "not_run" else "automated_test")
            recorder.record(
                identifier,
                status,
                kind=kind,
                reference=f"test_{prototype}_acceptance_{index:02d}",
                observed=f"observed assertion {identifier} from executable test case {index}",
            )
        return recorder.as_document()

    def test_catalog_contains_exactly_thirty_ordered_ids(self) -> None:
        self.assertEqual(acceptance_ids(), tuple(f"AC-{index:02d}" for index in range(1, 31)))

    def test_recorder_refuses_incomplete_output(self) -> None:
        recorder = AcceptanceRecorder(
            prototype="wagtail",
            runner="runner",
            command="command",
            source_digest="0" * 64,
            source_files=("spikes/val02_contract/tests/test_acceptance_results.py",),
        )
        with self.assertRaisesRegex(ValueError, "missing"):
            recorder.as_document()

    def test_pair_validator_reads_both_generated_results_and_computes_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "runner.py"
            source.write_text("# executable test runner\n", encoding="utf-8")
            wagtail = self._document("wagtail", source)
            payload = self._document("payload", source, {"AC-29": "fail", "AC-28": "not_run"})
            wagtail_path = root / "wagtail.json"
            payload_path = root / "payload.json"
            wagtail_path.write_text(json.dumps(wagtail), encoding="utf-8")
            payload_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = validate_pair(wagtail_path, payload_path, enforce_prototype_source=False)
        self.assertEqual(summary["results"]["wagtail"]["computed_counts"], {"pass": 30, "fail": 0, "not_run": 0})
        self.assertEqual(summary["results"]["payload"]["computed_counts"], {"pass": 28, "fail": 1, "not_run": 1})
        self.assertTrue(summary["pair_valid"])

    def test_result_cannot_claim_its_own_overall_or_pass_count(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("wagtail", source)
            result["pass_count"] = 30
            with self.assertRaisesRegex(ResultValidationError, "unexpected top-level"):
                validate_result_document(result, expected_prototype="wagtail", enforce_prototype_source=False)

    def test_generic_handwritten_evidence_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("wagtail", source)
            result["assertions"][0]["evidence"][0]["observed"] = "all passed"
            with self.assertRaisesRegex(ResultValidationError, "generic claim"):
                validate_result_document(result, expected_prototype="wagtail", enforce_prototype_source=False)

    def test_missing_or_duplicate_id_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("wagtail", source)
            result["assertions"][1]["id"] = "AC-01"
            with self.assertRaisesRegex(ResultValidationError, "exactly once"):
                validate_result_document(result, expected_prototype="wagtail", enforce_prototype_source=False)

    def test_stale_fixture_digest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("payload", source)
            result["fixture_sha256"] = "0" * 64
            with self.assertRaisesRegex(ResultValidationError, "current shared fixture"):
                validate_result_document(result, expected_prototype="payload", enforce_prototype_source=False)

    def test_source_digest_is_recomputed_from_referenced_files(self) -> None:
        result = self._document("payload", Path(__file__))
        result["generated_by"]["source_digest"] = "0" * 64
        with self.assertRaisesRegex(ResultValidationError, "does not match"):
            validate_result_document(result, expected_prototype="payload", enforce_prototype_source=False)

    def test_production_validation_requires_actual_prototype_source(self) -> None:
        result = self._document("wagtail", Path(__file__))
        with self.assertRaisesRegex(ResultValidationError, "actual wagtail prototype"):
            validate_result_document(result, expected_prototype="wagtail")

    def test_not_run_requires_blocker_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("payload", source, {"AC-02": "not_run"})
            result["assertions"][1]["evidence"][0]["kind"] = "automated_test"
            with self.assertRaisesRegex(ResultValidationError, "must cite a blocker"):
                validate_result_document(result, expected_prototype="payload", enforce_prototype_source=False)

    def test_require_all_pass_is_computed_not_trusted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "runner.py"
            source.write_text("# runner\n", encoding="utf-8")
            result = self._document("wagtail", source, {"AC-13": "fail"})
            with self.assertRaisesRegex(ResultValidationError, "expected all 30"):
                validate_result_document(
                    result,
                    expected_prototype="wagtail",
                    require_all_pass=True,
                    enforce_prototype_source=False,
                )

    def test_schema_files_are_valid_json(self) -> None:
        for path in (CONTRACT_DIR / "schemas").glob("*.json"):
            self.assertIsInstance(json.loads(path.read_text(encoding="utf-8")), dict)


if __name__ == "__main__":
    unittest.main()
