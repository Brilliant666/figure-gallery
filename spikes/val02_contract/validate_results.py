"""Validate and compare machine-generated acceptance results from both prototypes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from .acceptance_result import CONTRACT_PATH, REPOSITORY_ROOT, acceptance_ids, digest_source_files
    from .fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256
except ImportError:  # direct script execution
    from acceptance_result import CONTRACT_PATH, REPOSITORY_ROOT, acceptance_ids, digest_source_files
    from fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256


DEFAULT_WAGTAIL_RESULT = Path("spikes/val02_wagtail/acceptance-results.json")
DEFAULT_PAYLOAD_RESULT = Path("spikes/val02_payload/acceptance-results.json")
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_TOP_LEVEL = {
    "schema_version",
    "contract_id",
    "prototype",
    "generated_at",
    "generated_by",
    "fixture_sha256",
    "runtime",
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
    "ui_test",
    "export_parse",
    "binary_scan",
    "media_test",
    "network_guard_test",
    "static_assertion",
    "blocker",
}


class ResultValidationError(ValueError):
    """Raised for result documents that do not prove contract execution."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ResultValidationError(message)


def load_result(path: Path | str) -> dict[str, Any]:
    try:
        result = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ResultValidationError(f"acceptance result does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ResultValidationError(f"acceptance result is not valid JSON: {path}: {exc}") from exc
    _require(isinstance(result, dict), "acceptance result root must be an object")
    return result


def validate_result_document(
    result: dict[str, Any],
    *,
    expected_prototype: str,
    fixture_path: Path | str = DEFAULT_FIXTURE_PATH,
    require_all_pass: bool = False,
    enforce_prototype_source: bool = True,
) -> dict[str, int]:
    """Validate structure and evidence, then compute (never trust) status counts."""

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
    _require(required <= result.keys(), f"missing result fields: {sorted(required - result.keys())}")
    _require(result["schema_version"] == 1, "result schema_version must be 1")
    _require(result["contract_id"] == "val02-acceptance-v1", "unexpected contract_id")
    _require(result["prototype"] == expected_prototype, f"expected prototype {expected_prototype!r}")
    _require(result["fixture_sha256"] == fixture_sha256(fixture_path), "result was not generated from the current shared fixture")
    try:
        generated_at = datetime.fromisoformat(result["generated_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise ResultValidationError("generated_at must be an ISO-8601 timestamp") from exc
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
    _require(isinstance(source_files, list) and source_files, "generated_by.source_files must be a non-empty array")
    _require(all(isinstance(item, str) and item for item in source_files), "source file references must be strings")
    _require(source_files == sorted(set(source_files)), "source file references must be sorted and unique")
    source_paths: list[Path] = []
    for reference in source_files:
        candidate = Path(reference)
        _require(not candidate.is_absolute(), "source file references must be repository-relative")
        resolved = (REPOSITORY_ROOT / candidate).resolve()
        _require(REPOSITORY_ROOT == resolved or REPOSITORY_ROOT in resolved.parents, "source file reference escapes repository")
        _require(resolved.is_file(), f"source evidence file does not exist: {reference}")
        source_paths.append(resolved)
    prototype_prefix = f"spikes/val02_{expected_prototype}/"
    if enforce_prototype_source:
        _require(
            any(reference.replace("\\", "/").startswith(prototype_prefix) for reference in source_files),
            f"source evidence must include the actual {expected_prototype} prototype",
        )
    _require(
        digest_source_files(source_paths) == generated_by["source_digest"],
        "source_digest does not match the referenced implementation/test files",
    )

    for optional_object in ("runtime", "metrics", "exports", "security"):
        if optional_object in result:
            _require(isinstance(result[optional_object], dict), f"{optional_object} must be an object")

    assertions = result["assertions"]
    _require(isinstance(assertions, list), "assertions must be an array")
    expected_ids = acceptance_ids()
    _require(len(assertions) == len(expected_ids) == 30, "result must contain exactly 30 assertions")
    ids = [item.get("id") if isinstance(item, dict) else None for item in assertions]
    _require(tuple(ids) == expected_ids, "assertions must contain AC-01..AC-30 exactly once in contract order")

    counts = {"pass": 0, "fail": 0, "not_run": 0}
    distinct_evidence: set[tuple[str, str, str]] = set()
    for assertion in assertions:
        _require(set(assertion) == {"id", "status", "evidence"}, f"{assertion['id']} has wrong fields")
        status = assertion["status"]
        _require(status in counts, f"{assertion['id']} has unsupported status {status!r}")
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
            _require(generic not in {"pass", "passed", "ok", "all passed", "通过", "全部通过"}, f"{assertion['id']} evidence is a hand-written generic claim")
            kinds.add(item["kind"])
            distinct_evidence.add((item["kind"], item["reference"], item["observed"]))
        if status == "pass":
            _require("blocker" not in kinds or len(kinds) > 1, f"{assertion['id']} cannot pass on blocker-only evidence")
        if status == "not_run":
            _require("blocker" in kinds, f"{assertion['id']} not_run must cite a blocker")
        counts[status] += 1

    _require(len(distinct_evidence) >= 15, "result evidence is suspiciously repetitive")
    ac30 = assertions[-1]
    ac30_kinds = {item["kind"] for item in ac30["evidence"]}
    if ac30["status"] == "pass":
        _require(ac30_kinds & {"network_guard_test", "static_assertion"}, "AC-30 needs network guard/static evidence")
    if require_all_pass:
        _require(counts["pass"] == 30, f"expected all 30 assertions to pass, got {counts}")
    return counts


def validate_pair(
    wagtail_path: Path | str,
    payload_path: Path | str,
    *,
    fixture_path: Path | str = DEFAULT_FIXTURE_PATH,
    require_all_pass: bool = False,
    enforce_prototype_source: bool = True,
) -> dict[str, Any]:
    wagtail = load_result(wagtail_path)
    payload = load_result(payload_path)
    wagtail_counts = validate_result_document(
        wagtail,
        expected_prototype="wagtail",
        fixture_path=fixture_path,
        require_all_pass=require_all_pass,
        enforce_prototype_source=enforce_prototype_source,
    )
    payload_counts = validate_result_document(
        payload,
        expected_prototype="payload",
        fixture_path=fixture_path,
        require_all_pass=require_all_pass,
        enforce_prototype_source=enforce_prototype_source,
    )
    return {
        "schema_version": 1,
        "contract_id": "val02-acceptance-v1",
        "contract_sha256": hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),
        "fixture_sha256": fixture_sha256(fixture_path),
        "results": {
            "wagtail": {"path": str(Path(wagtail_path)), "computed_counts": wagtail_counts},
            "payload": {"path": str(Path(payload_path)), "computed_counts": payload_counts},
        },
        "pair_valid": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wagtail", type=Path, default=DEFAULT_WAGTAIL_RESULT)
    parser.add_argument("--payload", type=Path, default=DEFAULT_PAYLOAD_RESULT)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--require-all-pass", action="store_true")
    parser.add_argument("--output", type=Path, help="Optional path for the validator-computed summary")
    args = parser.parse_args()
    try:
        summary = validate_pair(
            args.wagtail,
            args.payload,
            fixture_path=args.fixture,
            require_all_pass=args.require_all_pass,
        )
    except ResultValidationError as exc:
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
