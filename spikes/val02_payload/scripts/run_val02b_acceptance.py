"""Run Payload VAL-02B tests and emit the shared 30-gate result."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PROTOTYPE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PROTOTYPE_ROOT.parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from spikes.val02_contract.val02b_acceptance_result import (  # noqa: E402
    Val02bAcceptanceRecorder,
)


def source_files() -> list[Path]:
    included: list[Path] = []
    for base in (PROTOTYPE_ROOT / "src", PROTOTYPE_ROOT / "scripts", PROTOTYPE_ROOT / "tests"):
        for path in base.rglob("*"):
            if path.is_file() and path.suffix in {".css", ".js", ".json", ".mjs", ".py", ".ts", ".tsx"}:
                included.append(path)
    included.extend(
        PROTOTYPE_ROOT / name
        for name in (
            ".env.example",
            "README.md",
            "eslint.config.mjs",
            "next.config.mjs",
            "package-lock.json",
            "package.json",
            "tsconfig.json",
            "vitest.config.ts",
        )
    )
    included.extend(
        REPOSITORY_ROOT / reference
        for reference in (
            "spikes/val02_contract/fixtures/domain_fixture.json",
            "spikes/val02_contract/python_candidate_client/client.py",
            "spikes/val02_contract/val02b_acceptance_contract.json",
            "spikes/val02_contract/val02b_acceptance_result.py",
        )
    )
    return sorted(set(path for path in included if path.is_file()))


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=PROTOTYPE_ROOT,
        check=True,
        capture_output=capture,
        text=True,
    )


def run_checks() -> tuple[dict[str, int], set[str]]:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("npm is not available on PATH")
    run([npm, "run", "typecheck"])
    run([npm, "run", "lint"])
    with tempfile.TemporaryDirectory(prefix="figure-gallery-payload-val02b-") as temporary:
        result_path = Path(temporary) / "vitest.json"
        run([npm, "test", "--", "--reporter=json", f"--outputFile={result_path}"])
        result = json.loads(result_path.read_text(encoding="utf-8"))
    counts = {
        "passed": int(result["numPassedTests"]),
        "failed": int(result["numFailedTests"]),
        "total": int(result["numTotalTests"]),
    }
    if counts["failed"] or counts["passed"] != counts["total"]:
        raise RuntimeError(f"VAL-02B requires a fully passing suite, got {counts}")
    names = {
        str(assertion["fullName"])
        for test_result in result["testResults"]
        for assertion in test_result["assertionResults"]
        if assertion["status"] == "passed"
    }
    return counts, names


def loc_metrics() -> dict[str, int]:
    generated = {"payload-types.ts", "importMap.js"}
    implementation = tests = admin = endpoints = 0
    for path in source_files():
        if PROTOTYPE_ROOT not in path.parents or path.name in generated or "migrations" in path.parts:
            continue
        if path.suffix not in {".py", ".ts", ".tsx"}:
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        relative = path.relative_to(PROTOTYPE_ROOT).as_posix()
        if relative.startswith("tests/"):
            tests += lines
        elif relative.startswith("src/components/admin/"):
            admin += lines
            implementation += lines
        elif relative.startswith("src/endpoints/"):
            endpoints += lines
            implementation += lines
        else:
            implementation += lines
    return {
        "implementation_loc_excluding_generated_and_migrations": implementation,
        "test_loc": tests,
        "admin_ui_loc": admin,
        "endpoint_loc": endpoints,
    }


def browser_assertions(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    assertions = document.get("assertions")
    if not isinstance(assertions, list):
        raise RuntimeError("browser result must contain top-level assertions array")
    mapped = {str(item.get("id")): item for item in assertions if isinstance(item, dict)}
    if set(mapped) != {"BG-01", "BG-02", "BG-03", "BG-04"}:
        raise RuntimeError("browser result must contain BG-01..BG-04 exactly once")
    return mapped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-results", type=Path)
    parser.add_argument("--loopback-results", type=Path)
    parser.add_argument("--output", type=Path, default=PROTOTYPE_ROOT / "val02b-acceptance-results.json")
    args = parser.parse_args()

    counts, passed_names = run_checks()
    package = json.loads((PROTOTYPE_ROOT / "package.json").read_text(encoding="utf-8"))
    browser = browser_assertions(args.browser_results)
    loopback = (
        json.loads(args.loopback_results.read_text(encoding="utf-8"))
        if args.loopback_results
        else None
    )
    if loopback is not None and loopback.get("status") != "passed":
        raise RuntimeError("loopback summary does not prove a passed shared Python client run")

    recorder = Val02bAcceptanceRecorder.from_source_files(
        prototype="payload",
        runner="vitest-payload-val02b-runner",
        command="python spikes/val02_payload/scripts/run_val02b_acceptance.py",
        source_files=source_files(),
        runtime={
            "node": run([shutil.which("node") or "node", "--version"], capture=True).stdout.strip(),
            "npm": package["packageManager"],
            "payload": package["dependencies"]["payload"],
            "next": package["dependencies"]["next"],
            "database_executed": "SQLite",
        },
        environment={
            "postgresql": "environment_blocked",
            "s3_compatible_storage": "environment_blocked",
            "full_production_shape": "environment_blocked without PostgreSQL/S3",
        },
        metrics={"automated_tests": counts, **loc_metrics()},
        security={
            "candidate_credential_storage": "runtime token represented only by SHA-256 hash",
            "candidate_generic_crud": "closed",
            "hpoi_network_guard": "enabled",
            "owner_isolation": "server enforced",
        },
    )

    for identifier in ("BG-01", "BG-02", "BG-03", "BG-04"):
        item = browser.get(identifier)
        if item is None:
            recorder.record(
                identifier,
                "not_run",
                kind="blocker",
                reference="--browser-results was not supplied",
                observed="Real Playwright evidence has not yet been attached to this generated result.",
            )
            continue
        status = item.get("status")
        evidence = item.get("evidence")
        if status not in {"pass", "fail", "not_run", "environment_blocked"} or not isinstance(evidence, list) or not evidence:
            raise RuntimeError(f"invalid browser assertion {identifier}")
        first, *rest = evidence
        recorder.record(identifier, status, **first)
        for extra in rest:
            recorder.add_evidence(identifier, **extra)

    if loopback is None:
        recorder.record(
            "BG-05",
            "not_run",
            kind="blocker",
            reference="--loopback-results was not supplied",
            observed="Shared Python CandidateClient multipart transport has not yet been attached to this generated result.",
        )
    else:
        recorder.record(
            "BG-05",
            "pass",
            kind="file_upload_test",
            reference="scripts/live_python_client_smoke.py over a real loopback Next/Payload server",
            observed=(
                "Shared CandidateClient created a multipart media record, then a renamed identical upload "
                f"reused media identity={bool(loopback.get('multipart_media_stable'))}."
            ),
        )

    evidence = {
        "BG-06": ("file_upload_test", "closes the synthetic multipart candidate-media loop", "Server decoded PNG bytes and verified SHA-256, 64-bit aHash, MIME type, dimensions and byte size."),
        "BG-07": ("file_upload_test", "closes the synthetic multipart candidate-media loop", "Renamed identical bytes reused one media ID; changed bytes under a reused idempotency key returned HTTP 409."),
        "BG-08": ("file_upload_test", "closes the synthetic multipart candidate-media loop", "Text, MIME mismatch and oversize payloads were rejected before formal mutation; a valid retry created candidate-only media."),
        "BG-09": ("auth_test", "enforces current per-client identity, owner isolation, revocation and formal-data boundaries", "Client B could neither upsert client A's source/candidate nor upload media into A's candidate."),
        "BG-10": ("auth_test", "enforces current per-client identity, owner isolation, revocation and formal-data boundaries", "Hash-only runtime credential authenticated before revocation and returned HTTP 403 after server-side disable."),
        "BG-11": ("api_permission_test", "enforces current per-client identity, owner isolation, revocation and formal-data boundaries", "Candidate identity and its generic CRUD path could not update FigurePrototype or other formal collections."),
        "BG-12": ("api_permission_test", "enforces current per-client identity, owner isolation, revocation and formal-data boundaries", "Candidate main-image action returned HTTP 403 and candidate media remained selectedAsMain=false."),
        "BG-13": ("admin_workflow_test", "rejects review endpoint writes without work-item authorization or with stale/out-of-scope targets", "The live review handler rejected missing work-item context and an out-of-scope target before any formal mutation; new targets can only be created atomically by the review service."),
        "BG-14": ("concurrency_test", "rejects review endpoint writes without work-item authorization or with stale/out-of-scope targets", "The live review handler returned a version conflict to the second administrator's stale submit and did not silently overwrite."),
        "BG-15": ("concurrency_test", "uses stable scoped operation IDs for independent specified undo", "Merge and split produced stable UUID operation IDs and each was undone by its requested ID."),
        "BG-16": ("concurrency_test", "propagates handler dependencies and blocks omitted dependencies by overlapping scope", "The real administrator handler propagated dependency IDs; both explicit dependency and overlapping-scope fallback blocked unsafe prerequisite undo."),
        "BG-30": ("admin_ui_test", "exposes all required audited domain commands in the administrator UI", "Candidate review and domain command views expose the complete minimum command set, including SystemSetting and specified undo."),
    }
    for identifier, (kind, reference, observed) in evidence.items():
        if not any(reference in name for name in passed_names):
            raise RuntimeError(f"{identifier} evidence did not match a passed Vitest name: {reference}")
        recorder.record(identifier, "pass", kind=kind, reference=reference, observed=observed)
    generic_crud_reference = "closes generic formal and global CRUD while controlled services remain available"
    if not any(generic_crud_reference in name for name in passed_names):
        raise RuntimeError(f"BG-30 evidence did not match a passed Vitest name: {generic_crud_reference}")
    recorder.add_evidence(
        "BG-30",
        kind="api_permission_test",
        reference=generic_crud_reference,
        observed="Create/update/delete access was denied outside controlled services; OperationLog itself remained append-only.",
    )

    for number in range(17, 30):
        identifier = f"BG-{number:02d}"
        recorder.record(
            identifier,
            "environment_blocked",
            kind="blocker",
            reference="research/evidence/val02b/environment.json",
            observed="Docker engine, PostgreSQL and loopback S3 service were unavailable and task policy forbade installing or starting system infrastructure; partial SQLite/local observations are not counted as this gate.",
        )

    output = recorder.write(args.output)
    print(json.dumps({"output": str(output), "status": "generated"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
