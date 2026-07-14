from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from val02b_acceptance_result import (  # noqa: E402
    Val02bAcceptanceRecorder,
    val02b_acceptance_ids,
)
from validate_val02b_results import (  # noqa: E402
    Val02bResultValidationError,
    validate_val02b_contract_document,
    validate_val02b_pair,
    validate_val02b_result_document,
)


class Val02bAcceptanceResultTests(unittest.TestCase):
    def _document(
        self,
        prototype: str,
        statuses: dict[str, str] | None = None,
    ) -> dict:
        recorder = Val02bAcceptanceRecorder.from_source_files(
            prototype=prototype,
            runner="unittest-val02b-acceptance-runner",
            command=f"python -m {prototype}.tests --emit-val02b-acceptance",
            source_files=[Path(__file__)],
            runtime={"language": "test-runtime"},
            environment={"network_guard": "enabled"},
            security={"credential_source": "runtime-only"},
        )
        statuses = statuses or {}
        for index, identifier in enumerate(val02b_acceptance_ids(), start=1):
            status = statuses.get(identifier, "pass")
            if status in {"not_run", "environment_blocked"}:
                kind = "blocker"
            elif identifier in {f"BG-{number:02d}" for number in range(1, 5)}:
                kind = "browser_test"
            elif identifier in {f"BG-{number:02d}" for number in range(17, 23)}:
                kind = "database_test"
            elif identifier in {f"BG-{number:02d}" for number in range(23, 29)}:
                kind = "storage_test"
            elif identifier == "BG-29":
                kind = "deployment_test"
            else:
                kind = "automated_test"
            recorder.record(
                identifier,
                status,
                kind=kind,
                reference=f"test_{prototype}_bg_{index:02d}",
                observed=(
                    f"executable PostgreSQL observation for {identifier} from isolated test {index}"
                    if 17 <= index <= 22
                    else f"executable observation for {identifier} from isolated test {index}"
                ),
            )
        return recorder.as_document()

    def test_contract_has_exact_gate_status_hard_gate_and_score_shape(self) -> None:
        contract = json.loads(
            (CONTRACT_DIR / "val02b_acceptance_contract.json").read_text(encoding="utf-8")
        )
        summary = validate_val02b_contract_document(contract)
        self.assertEqual(val02b_acceptance_ids(), tuple(f"BG-{index:02d}" for index in range(1, 31)))
        self.assertEqual(summary, {"item_count": 30, "hard_condition_count": 8, "scoring_weight": 100})
        self.assertEqual(
            contract["status_values"],
            ["pass", "fail", "not_run", "environment_blocked"],
        )

    def test_contract_rejects_asymmetric_hard_gate_mapping(self) -> None:
        contract = json.loads(
            (CONTRACT_DIR / "val02b_acceptance_contract.json").read_text(encoding="utf-8")
        )
        mutated = copy.deepcopy(contract)
        mutated["hard_failure_conditions"][0]["acceptance_ids"] = ["BG-10"]
        with self.assertRaisesRegex(Val02bResultValidationError, "symmetrically"):
            validate_val02b_contract_document(mutated)

    def test_contract_rejects_score_not_equal_to_one_hundred(self) -> None:
        contract = json.loads(
            (CONTRACT_DIR / "val02b_acceptance_contract.json").read_text(encoding="utf-8")
        )
        mutated = copy.deepcopy(contract)
        mutated["scoring"][0]["weight"] -= 1
        with self.assertRaisesRegex(Val02bResultValidationError, "total 100"):
            validate_val02b_contract_document(mutated)

    def test_recorder_rejects_manual_or_unknown_prototype(self) -> None:
        arguments = {
            "prototype": "wagtail",
            "runner": "manual",
            "command": "command",
            "source_files": [Path(__file__)],
        }
        with self.assertRaisesRegex(ValueError, "non-manual"):
            Val02bAcceptanceRecorder.from_source_files(**arguments)
        arguments.update(prototype="other", runner="runner")
        with self.assertRaisesRegex(ValueError, "unsupported"):
            Val02bAcceptanceRecorder.from_source_files(**arguments)

    def test_recorder_refuses_incomplete_output(self) -> None:
        recorder = Val02bAcceptanceRecorder.from_source_files(
            prototype="wagtail",
            runner="runner",
            command="command",
            source_files=[Path(__file__)],
        )
        recorder.record(
            "BG-01",
            "pass",
            kind="browser_test",
            reference="real_browser_login",
            observed="Chrome reached the synthetic administrator landing page",
        )
        with self.assertRaisesRegex(ValueError, "missing"):
            recorder.as_document()

    def test_pair_validator_computes_four_statuses_and_hard_gate_outcomes(self) -> None:
        wagtail = self._document(
            "wagtail",
            {
                "BG-09": "fail",
                "BG-17": "environment_blocked",
                "BG-18": "not_run",
                "BG-29": "environment_blocked",
            },
        )
        payload = self._document(
            "payload",
            {"BG-21": "environment_blocked", "BG-29": "environment_blocked"},
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wagtail_path = root / "wagtail.json"
            payload_path = root / "payload.json"
            wagtail_path.write_text(json.dumps(wagtail), encoding="utf-8")
            payload_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = validate_val02b_pair(
                wagtail_path,
                payload_path,
                enforce_prototype_source=False,
            )
        self.assertEqual(
            summary["results"]["wagtail"]["computed_counts"],
            {"pass": 26, "fail": 1, "not_run": 1, "environment_blocked": 2},
        )
        self.assertIn(
            "candidate-owner-isolation",
            summary["results"]["wagtail"]["hard_gates"]["failed"],
        )
        self.assertIn(
            "postgresql-restore-consistency",
            summary["results"]["payload"]["hard_gates"]["environment_blocked"],
        )
        self.assertTrue(summary["pair_valid"])

    def test_environment_blocked_and_not_run_require_blocker_evidence(self) -> None:
        for status in ("environment_blocked", "not_run"):
            with self.subTest(status=status):
                result = self._document("payload", {"BG-17": status})
                result["assertions"][16]["evidence"][0]["kind"] = "database_test"
                with self.assertRaisesRegex(Val02bResultValidationError, "must cite a blocker"):
                    validate_val02b_result_document(
                        result,
                        expected_prototype="payload",
                        enforce_prototype_source=False,
                    )

    def test_environment_specific_passes_reject_static_or_wrong_runtime_evidence(self) -> None:
        cases = (
            ("BG-01", "static_assertion", "static login markup inspection", "requires evidence kinds"),
            ("BG-17", "automated_test", "SQLite fresh migration passed", "requires evidence kinds"),
            ("BG-23", "static_assertion", "S3 configuration fields exist", "requires evidence kinds"),
            ("BG-29", "runtime_probe", "loopback development server started", "requires evidence kinds"),
        )
        for identifier, kind, observed, message in cases:
            with self.subTest(identifier=identifier):
                result = self._document("wagtail")
                assertion = result["assertions"][int(identifier[-2:]) - 1]
                assertion["evidence"][0].update(kind=kind, observed=observed)
                with self.assertRaisesRegex(Val02bResultValidationError, message):
                    validate_val02b_result_document(
                        result,
                        expected_prototype="wagtail",
                        enforce_prototype_source=False,
                    )

    def test_database_kind_cannot_relabel_sqlite_as_postgresql_evidence(self) -> None:
        result = self._document("payload")
        result["assertions"][16]["evidence"][0]["observed"] = (
            "SQLite fresh migration and seed completed in a local file database"
        )
        with self.assertRaisesRegex(Val02bResultValidationError, "SQLite evidence"):
            validate_val02b_result_document(
                result,
                expected_prototype="payload",
                enforce_prototype_source=False,
            )

    def test_local_deployment_cannot_pass_while_postgresql_or_s3_is_blocked(self) -> None:
        for prerequisite in ("BG-17", "BG-23"):
            with self.subTest(prerequisite=prerequisite):
                result = self._document(
                    "payload",
                    {prerequisite: "environment_blocked"},
                )
                with self.assertRaisesRegex(
                    Val02bResultValidationError,
                    "BG-29 pass requires",
                ):
                    validate_val02b_result_document(
                        result,
                        expected_prototype="payload",
                        enforce_prototype_source=False,
                    )

    def test_hard_failure_can_be_enforced_without_treating_environment_blocked_as_failure(self) -> None:
        blocked = self._document("wagtail", {"BG-21": "environment_blocked"})
        validate_val02b_result_document(
            blocked,
            expected_prototype="wagtail",
            require_no_hard_failures=True,
            enforce_prototype_source=False,
        )
        failed = self._document("wagtail", {"BG-21": "fail"})
        with self.assertRaisesRegex(Val02bResultValidationError, "hard gate failures"):
            validate_val02b_result_document(
                failed,
                expected_prototype="wagtail",
                require_no_hard_failures=True,
                enforce_prototype_source=False,
            )

    def test_result_source_digest_and_generic_claim_are_rejected(self) -> None:
        result = self._document("payload")
        result["generated_by"]["source_digest"] = "0" * 64
        with self.assertRaisesRegex(Val02bResultValidationError, "does not match"):
            validate_val02b_result_document(
                result,
                expected_prototype="payload",
                enforce_prototype_source=False,
            )
        result = self._document("payload")
        result["assertions"][0]["evidence"][0]["observed"] = "all passed"
        with self.assertRaisesRegex(Val02bResultValidationError, "generic claim"):
            validate_val02b_result_document(
                result,
                expected_prototype="payload",
                enforce_prototype_source=False,
            )


if __name__ == "__main__":
    unittest.main()
