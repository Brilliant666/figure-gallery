"""Validate and compare machine-generated VAL-02B gate results."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from .acceptance_result import REPOSITORY_ROOT, digest_source_files
    from .fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256
    from .val02b_acceptance_result import (
        VAL02B_CONTRACT_ID,
        VAL02B_CONTRACT_PATH,
        VAL02B_PROTOTYPES,
        VAL02B_STATUS_VALUES,
        val02b_acceptance_ids,
    )
except ImportError:  # direct script execution
    from acceptance_result import REPOSITORY_ROOT, digest_source_files
    from fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256
    from val02b_acceptance_result import (
        VAL02B_CONTRACT_ID,
        VAL02B_CONTRACT_PATH,
        VAL02B_PROTOTYPES,
        VAL02B_STATUS_VALUES,
        val02b_acceptance_ids,
    )


DEFAULT_WAGTAIL_RESULT = Path("spikes/val02_wagtail/val02b-acceptance-results.json")
DEFAULT_PAYLOAD_RESULT = Path("spikes/val02_payload/val02b-acceptance-results.json")
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_TOP_LEVEL = {
    "schema_version",
    "contract_id",
    "prototype",
    "generated_at",
    "generated_by",
    "fixture_sha256",
    "runtime",
    "environment",
    "metrics",
    "exports",
    "security",
    "assertions",
}
ALLOWED_EVIDENCE_KINDS = {
    "automated_test",
    "runtime_probe",
    "api_permission_test",
    "admin_workflow_test",
    "admin_ui_test",
    "ui_test",
    "browser_test",
    "file_upload_test",
    "media_test",
    "auth_test",
    "concurrency_test",
    "database_test",
    "storage_test",
    "deployment_test",
    "export_parse",
    "binary_scan",
    "network_guard_test",
    "static_assertion",
    "blocker",
}

# A globally valid evidence label is not sufficient to prove an
# environment-specific gate.  These policies deliberately apply only to a
# ``pass`` result: failures still need to describe the test that was actually
# run, while not-run states are handled by the blocker requirement below.
PASS_REQUIRED_EVIDENCE_KINDS = {
    **{f"BG-{number:02d}": frozenset({"browser_test"}) for number in range(1, 5)},
    **{f"BG-{number:02d}": frozenset({"database_test"}) for number in range(17, 23)},
    **{f"BG-{number:02d}": frozenset({"storage_test"}) for number in range(23, 29)},
    "BG-29": frozenset({"deployment_test"}),
}
PASS_ALLOWED_EVIDENCE_KINDS = {
    **{f"BG-{number:02d}": frozenset({"browser_test"}) for number in range(1, 5)},
    **{
        f"BG-{number:02d}": frozenset(
            {"database_test", "export_parse", "automated_test"}
        )
        for number in range(17, 23)
    },
}


class Val02bResultValidationError(ValueError):
    """Raised when a result does not prove execution of the shared gates."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise Val02bResultValidationError(message)


def _contract() -> dict[str, Any]:
    return json.loads(VAL02B_CONTRACT_PATH.read_text(encoding="utf-8"))


def validate_val02b_contract_document(contract: dict[str, Any]) -> dict[str, Any]:
    """Validate the gate catalog itself before trusting prototype results."""

    expected_top_level = {
        "schema_version",
        "contract_id",
        "result_prototypes",
        "status_values",
        "items",
        "hard_failure_conditions",
        "scoring",
    }
    _require(isinstance(contract, dict), "VAL-02B contract root must be an object")
    _require(set(contract) == expected_top_level, "VAL-02B contract has wrong top-level fields")
    _require(contract["schema_version"] == 1, "VAL-02B contract schema_version must be 1")
    _require(contract["contract_id"] == VAL02B_CONTRACT_ID, "VAL-02B contract_id is invalid")
    _require(contract["result_prototypes"] == ["wagtail", "payload"], "prototype order is invalid")
    _require(set(contract["result_prototypes"]) == VAL02B_PROTOTYPES, "prototype set is invalid")
    _require(
        contract["status_values"] == ["pass", "fail", "not_run", "environment_blocked"],
        "VAL-02B statuses are invalid",
    )

    items = contract["items"]
    _require(isinstance(items, list) and len(items) == 30, "VAL-02B contract needs exactly 30 items")
    expected_ids = tuple(f"BG-{index:02d}" for index in range(1, 31))
    ids = tuple(item.get("id") if isinstance(item, dict) else None for item in items)
    _require(ids == expected_ids, "VAL-02B items must be ordered BG-01..BG-30 exactly once")
    allowed_item_fields = {
        "id",
        "title",
        "requirement",
        "preferred_evidence",
        "environment_requirements",
        "hard_gate_conditions",
    }
    item_hard_mappings: dict[str, set[str]] = {}
    for item in items:
        _require(set(item) <= allowed_item_fields, f"{item['id']} has unexpected contract fields")
        _require(
            {"id", "title", "requirement", "preferred_evidence"} <= item.keys(),
            f"{item['id']} is missing contract fields",
        )
        _require(
            all(isinstance(item[name], str) and item[name].strip() for name in ("title", "requirement")),
            f"{item['id']} title and requirement must be non-empty",
        )
        preferred = item["preferred_evidence"]
        _require(isinstance(preferred, list) and preferred, f"{item['id']} needs preferred evidence")
        _require(
            len(preferred) == len(set(preferred)) and set(preferred) <= ALLOWED_EVIDENCE_KINDS,
            f"{item['id']} has invalid preferred evidence",
        )
        environment = item.get("environment_requirements", [])
        _require(
            isinstance(environment, list)
            and len(environment) == len(set(environment))
            and all(isinstance(value, str) and value.strip() for value in environment),
            f"{item['id']} has invalid environment requirements",
        )
        hard_ids = item.get("hard_gate_conditions", [])
        _require(
            isinstance(hard_ids, list)
            and len(hard_ids) == len(set(hard_ids))
            and all(isinstance(value, str) and value.strip() for value in hard_ids),
            f"{item['id']} has invalid hard-gate mappings",
        )
        for hard_id in hard_ids:
            item_hard_mappings.setdefault(hard_id, set()).add(item["id"])

    hard_conditions = contract["hard_failure_conditions"]
    _require(isinstance(hard_conditions, list) and len(hard_conditions) == 8, "exactly eight hard conditions are required")
    hard_ids: list[str] = []
    for condition in hard_conditions:
        _require(
            isinstance(condition, dict) and set(condition) == {"id", "description", "acceptance_ids"},
            "hard condition has wrong fields",
        )
        _require(
            isinstance(condition["id"], str)
            and condition["id"].strip()
            and isinstance(condition["description"], str)
            and condition["description"].strip(),
            "hard condition identity is invalid",
        )
        mapped = condition["acceptance_ids"]
        _require(
            isinstance(mapped, list)
            and mapped
            and len(mapped) == len(set(mapped))
            and set(mapped) <= set(expected_ids),
            f"hard condition {condition['id']} has invalid gate mappings",
        )
        _require(
            item_hard_mappings.get(condition["id"], set()) == set(mapped),
            f"hard condition {condition['id']} is not mapped symmetrically",
        )
        hard_ids.append(condition["id"])
    _require(len(hard_ids) == len(set(hard_ids)), "hard condition IDs must be unique")
    _require(set(item_hard_mappings) == set(hard_ids), "item references an unknown hard condition")

    scoring = contract["scoring"]
    _require(isinstance(scoring, list) and len(scoring) == 9, "exactly nine scoring dimensions are required")
    _require(
        all(
            isinstance(item, dict)
            and set(item) == {"criterion", "weight"}
            and isinstance(item["criterion"], str)
            and item["criterion"].strip()
            and isinstance(item["weight"], int)
            and item["weight"] > 0
            for item in scoring
        ),
        "scoring dimensions are invalid",
    )
    _require(len({item["criterion"] for item in scoring}) == 9, "scoring dimensions must be unique")
    _require(sum(item["weight"] for item in scoring) == 100, "scoring weights must total 100")
    return {
        "item_count": len(items),
        "hard_condition_count": len(hard_conditions),
        "scoring_weight": 100,
    }


def load_val02b_result(path: Path | str) -> dict[str, Any]:
    try:
        result = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise Val02bResultValidationError(f"VAL-02B result does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise Val02bResultValidationError(f"VAL-02B result is not valid JSON: {path}: {exc}") from exc
    _require(isinstance(result, dict), "VAL-02B result root must be an object")
    return result


def _hard_gate_summary(assertions: list[dict[str, Any]]) -> dict[str, list[str]]:
    statuses = {item["id"]: item["status"] for item in assertions}
    failed: list[str] = []
    environment_blocked: list[str] = []
    not_run: list[str] = []
    for condition in _contract()["hard_failure_conditions"]:
        mapped = [statuses[identifier] for identifier in condition["acceptance_ids"]]
        if "fail" in mapped:
            failed.append(condition["id"])
        elif "environment_blocked" in mapped:
            environment_blocked.append(condition["id"])
        elif "not_run" in mapped:
            not_run.append(condition["id"])
    return {
        "failed": failed,
        "environment_blocked": environment_blocked,
        "not_run": not_run,
    }


def validate_val02b_result_document(
    result: dict[str, Any],
    *,
    expected_prototype: str,
    fixture_path: Path | str = DEFAULT_FIXTURE_PATH,
    require_all_pass: bool = False,
    require_no_hard_failures: bool = False,
    enforce_prototype_source: bool = True,
) -> dict[str, Any]:
    """Validate evidence and recompute status counts and hard-gate outcomes."""

    validate_val02b_contract_document(_contract())
    _require(set(result) <= ALLOWED_TOP_LEVEL, f"unexpected top-level fields: {sorted(set(result) - ALLOWED_TOP_LEVEL)}")
    required = {
        "schema_version",
        "contract_id",
        "prototype",
        "generated_at",
        "generated_by",
        "fixture_sha256",
        "assertions",
    }
    _require(required <= result.keys(), f"missing VAL-02B result fields: {sorted(required - result.keys())}")
    _require(result["schema_version"] == 1, "VAL-02B result schema_version must be 1")
    _require(result["contract_id"] == VAL02B_CONTRACT_ID, "unexpected VAL-02B contract_id")
    _require(result["prototype"] == expected_prototype, f"expected prototype {expected_prototype!r}")
    _require(result["fixture_sha256"] == fixture_sha256(fixture_path), "result was not generated from the current shared fixture")
    try:
        generated_at = datetime.fromisoformat(result["generated_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise Val02bResultValidationError("generated_at must be an ISO-8601 timestamp") from exc
    _require(generated_at.tzinfo is not None, "generated_at must include a timezone")

    generated_by = result["generated_by"]
    _require(isinstance(generated_by, dict), "generated_by must be an object")
    _require(
        set(generated_by) == {"runner", "command", "source_digest", "source_files"},
        "generated_by has wrong fields",
    )
    _require(isinstance(generated_by["runner"], str) and generated_by["runner"].strip(), "runner is required")
    _require(generated_by["runner"].strip().lower() != "manual", "manually authored result is not accepted")
    _require(isinstance(generated_by["command"], str) and generated_by["command"].strip(), "generator command is required")
    _require(isinstance(generated_by["source_digest"], str) and HEX_64.fullmatch(generated_by["source_digest"]) is not None, "source_digest must be a SHA-256")
    source_files = generated_by["source_files"]
    _require(isinstance(source_files, list) and source_files, "generated_by.source_files must be non-empty")
    _require(source_files == sorted(set(source_files)), "source file references must be sorted and unique")
    source_paths: list[Path] = []
    for reference in source_files:
        _require(isinstance(reference, str) and reference, "source file references must be strings")
        candidate = Path(reference)
        _require(not candidate.is_absolute(), "source file references must be repository-relative")
        resolved = (REPOSITORY_ROOT / candidate).resolve()
        _require(REPOSITORY_ROOT == resolved or REPOSITORY_ROOT in resolved.parents, "source file reference escapes repository")
        _require(resolved.is_file(), f"source evidence file does not exist: {reference}")
        source_paths.append(resolved)
    if enforce_prototype_source:
        prefix = f"spikes/val02_{expected_prototype}/"
        _require(
            any(reference.replace("\\", "/").startswith(prefix) for reference in source_files),
            f"source evidence must include the actual {expected_prototype} prototype",
        )
    _require(
        digest_source_files(source_paths) == generated_by["source_digest"],
        "source_digest does not match referenced implementation/test files",
    )

    for optional_object in ("runtime", "environment", "metrics", "exports", "security"):
        if optional_object in result:
            _require(isinstance(result[optional_object], dict), f"{optional_object} must be an object")

    assertions = result["assertions"]
    _require(isinstance(assertions, list), "assertions must be an array")
    expected_ids = val02b_acceptance_ids()
    _require(len(assertions) == len(expected_ids) == 30, "VAL-02B result must contain exactly 30 assertions")
    ids = [item.get("id") if isinstance(item, dict) else None for item in assertions]
    _require(tuple(ids) == expected_ids, "assertions must contain BG-01..BG-30 exactly once in contract order")

    counts = {status: 0 for status in ("pass", "fail", "not_run", "environment_blocked")}
    distinct_evidence: set[tuple[str, str, str]] = set()
    assertion_statuses = {item["id"]: item["status"] for item in assertions}
    for assertion in assertions:
        _require(set(assertion) == {"id", "status", "evidence"}, f"{assertion['id']} has wrong fields")
        status = assertion["status"]
        _require(status in VAL02B_STATUS_VALUES, f"{assertion['id']} has unsupported status {status!r}")
        evidence = assertion["evidence"]
        _require(isinstance(evidence, list) and evidence, f"{assertion['id']} needs evidence")
        kinds: set[str] = set()
        for item in evidence:
            _require(isinstance(item, dict), f"{assertion['id']} evidence must be objects")
            _require(set(item) == {"kind", "reference", "observed"}, f"{assertion['id']} evidence has wrong fields")
            _require(item["kind"] in ALLOWED_EVIDENCE_KINDS, f"{assertion['id']} has unsupported evidence kind")
            _require(isinstance(item["reference"], str) and item["reference"].strip(), f"{assertion['id']} evidence reference is empty")
            _require(isinstance(item["observed"], str) and item["observed"].strip(), f"{assertion['id']} observed value is empty")
            generic = item["observed"].strip().lower()
            _require(generic not in {"pass", "passed", "ok", "all passed", "通过", "全部通过"}, f"{assertion['id']} evidence is a generic claim")
            kinds.add(item["kind"])
            distinct_evidence.add((item["kind"], item["reference"], item["observed"]))
        if status == "pass":
            _require("blocker" not in kinds, f"{assertion['id']} cannot pass with blocker evidence")
            required_kinds = PASS_REQUIRED_EVIDENCE_KINDS.get(assertion["id"], frozenset())
            _require(
                required_kinds <= kinds,
                f"{assertion['id']} pass requires evidence kinds {sorted(required_kinds)}",
            )
            allowed_kinds = PASS_ALLOWED_EVIDENCE_KINDS.get(assertion["id"])
            if allowed_kinds is not None:
                _require(
                    kinds <= allowed_kinds,
                    f"{assertion['id']} pass has evidence kinds that cannot prove this gate",
                )
            if assertion["id"] in {f"BG-{number:02d}" for number in range(17, 23)}:
                evidence_text = " ".join(
                    f"{item['reference']} {item['observed']}" for item in evidence
                ).lower()
                _require(
                    "sqlite" not in evidence_text,
                    f"{assertion['id']} SQLite evidence cannot prove a PostgreSQL gate",
                )
        if status in {"not_run", "environment_blocked"}:
            _require("blocker" in kinds, f"{assertion['id']} {status} must cite a blocker")
        counts[status] += 1

    # BG-29 is explicitly a PostgreSQL + S3 production-shape deployment.  A
    # local WSGI/standalone smoke test cannot pass it while either prerequisite
    # environment remains unverified.
    if assertion_statuses["BG-29"] == "pass":
        _require(
            assertion_statuses["BG-17"] == "pass",
            "BG-29 pass requires a passed PostgreSQL fresh-migration gate (BG-17)",
        )
        _require(
            assertion_statuses["BG-23"] == "pass",
            "BG-29 pass requires a passed S3 upload gate (BG-23)",
        )

    _require(len(distinct_evidence) >= 15, "VAL-02B result evidence is suspiciously repetitive")
    hard_gates = _hard_gate_summary(assertions)
    if require_all_pass:
        _require(counts["pass"] == 30, f"expected all 30 VAL-02B gates to pass, got {counts}")
    if require_no_hard_failures:
        _require(not hard_gates["failed"], f"hard gate failures present: {hard_gates['failed']}")
    return {"computed_counts": counts, "hard_gates": hard_gates}


def validate_val02b_pair(
    wagtail_path: Path | str,
    payload_path: Path | str,
    *,
    fixture_path: Path | str = DEFAULT_FIXTURE_PATH,
    require_all_pass: bool = False,
    require_no_hard_failures: bool = False,
    enforce_prototype_source: bool = True,
) -> dict[str, Any]:
    wagtail = load_val02b_result(wagtail_path)
    payload = load_val02b_result(payload_path)
    wagtail_summary = validate_val02b_result_document(
        wagtail,
        expected_prototype="wagtail",
        fixture_path=fixture_path,
        require_all_pass=require_all_pass,
        require_no_hard_failures=require_no_hard_failures,
        enforce_prototype_source=enforce_prototype_source,
    )
    payload_summary = validate_val02b_result_document(
        payload,
        expected_prototype="payload",
        fixture_path=fixture_path,
        require_all_pass=require_all_pass,
        require_no_hard_failures=require_no_hard_failures,
        enforce_prototype_source=enforce_prototype_source,
    )
    return {
        "schema_version": 1,
        "contract_id": VAL02B_CONTRACT_ID,
        "contract_sha256": hashlib.sha256(VAL02B_CONTRACT_PATH.read_bytes()).hexdigest(),
        "fixture_sha256": fixture_sha256(fixture_path),
        "results": {
            "wagtail": {"path": str(Path(wagtail_path)), **wagtail_summary},
            "payload": {"path": str(Path(payload_path)), **payload_summary},
        },
        "pair_valid": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wagtail", type=Path, default=DEFAULT_WAGTAIL_RESULT)
    parser.add_argument("--payload", type=Path, default=DEFAULT_PAYLOAD_RESULT)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--require-all-pass", action="store_true")
    parser.add_argument("--require-no-hard-failures", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        summary = validate_val02b_pair(
            args.wagtail,
            args.payload,
            fixture_path=args.fixture,
            require_all_pass=args.require_all_pass,
            require_no_hard_failures=args.require_no_hard_failures,
        )
    except Val02bResultValidationError as exc:
        print(json.dumps({"pair_valid": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    rendered = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
