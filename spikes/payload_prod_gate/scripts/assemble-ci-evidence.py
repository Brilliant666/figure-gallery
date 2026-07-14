#!/usr/bin/env python3
"""Validate, minimize, and package Payload production-gate CI evidence.

The assembler is deliberately stricter than the scripts which create the stage
files.  A stage saying only ``status=pass`` is not evidence: every PG gate is
derived from concrete counts, digests, invariants, and attack outcomes below.

When the run itself fails, the assembler still emits a sanitized diagnostic
artifact.  Missing or invalid stages are then ``not_run``/``fail`` and can never
be promoted to a passing gate.  Credential-like or forbidden artifact content
always aborts assembly, including in diagnostic mode.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_FILES = (
    "run-status.json",
    "cleanup.json",
    "environment.json",
    "infrastructure.json",
    "schema-first.json",
    "schema-repeat.json",
    "schema-restored.json",
    "migration-fresh.json",
    "migration-repeat.json",
    "migration-seed.json",
    "regressions.json",
    "transaction-concurrency.json",
    "media-setup.json",
    "media-audit.json",
    "media-outage.json",
    "media-recover.json",
    "media-lifecycle.json",
    "media-backup-manifest.json",
    "media-purge.json",
    "media-restore.json",
    "media-migrate-prefix.json",
    "backup-restore.json",
    "restore-regressions.json",
    "restored-joint-smoke.json",
    "standalone.json",
    "standalone-attacks-clean-start.json",
    "standalone-attacks-restart.json",
)

OPTIONAL_SOURCE_FILES = {"failure-summary.json", "security-initial.json"}

RESERVED_OUTPUT_FILES = {"manifest.json", "production-gates.json"}
MAX_JSON_BYTES = 512 * 1024
MAX_TOTAL_JSON_BYTES = 4 * 1024 * 1024

FORBIDDEN_SUFFIXES = {
    ".backup",
    ".db",
    ".dump",
    ".env",
    ".jpeg",
    ".jpg",
    ".png",
    ".sqlite",
    ".tar",
    ".zip",
}

SENSITIVE_KEY = re.compile(
    r"(?:^|_)(?:authorization|credential|password|secret|access_?key|api_?key|token)(?:$|_)",
    re.IGNORECASE,
)

SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bgh[opsu]_[A-Za-z0-9_]{30,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"postgres(?:ql)?://[^\s:@/]+:[^\s@/]+@", re.IGNORECASE),
)

SHA256 = re.compile(r"^[0-9a-f]{64}$")
AHASH = re.compile(r"^[0-9a-f]{16}$")
IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_DIGEST = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")

EXPECTED_COLLECTIONS = {
    "candidate-records",
    "characters",
    "figure-prototypes",
    "figure-versions",
    "manufacturers",
    "media",
    "operation-logs",
    "review-work-items",
    "source-records",
    "works",
}

EXPECTED_SCHEMA_TABLES = {
    "candidate_records",
    "figure_prototypes",
    "figure_versions",
    "media",
    "operation_logs",
    "payload_migrations",
    "review_work_items",
    "source_records",
    "system_settings",
}

EXPECTED_SCHEMA_COLUMNS = {
    "candidate_records.candidate_owner_id",
    "figure_prototypes.main_image_id",
    "figure_prototypes.soft_deleted",
    "figure_versions.prototype_id",
    "media.candidate_owner_id",
    "media.prefix",
    "media.storage_key",
    "operation_logs.operation_i_d",
    "review_work_items.lock_version",
    "source_records.invalidated",
    "source_records.prototype_id",
    "source_records.source_key",
    "source_records.status",
}

EXPECTED_SCHEMA_UNIQUE_INDEXES = {
    "candidate_records_source_idx",
    "operation_logs_operation_i_d_idx",
    "source_records_source_key_idx",
}

EXPECTED_SCHEMA_FOREIGN_KEYS = {
    "candidate_records.candidate_owner_id->users",
    "figure_prototypes.main_image_id->media",
    "figure_versions.prototype_id->figure_prototypes",
    "media.candidate_owner_id->users",
    "source_records.prototype_id->figure_prototypes",
}

TRANSACTION_OUTCOMES = {
    "duplicate_stable_source_upsert": "idempotent_single_record",
    "url_fallback_to_stable_id": "migrated_without_duplicate",
    "multi_client_same_url": "isolated_records",
    "unique_constraint_conflict": "rejected_without_partial_commit",
    "duplicate_file_upload": "deduplicated",
    "optimistic_review_conflict": "exactly_one_commit",
    "merge": "committed_atomically",
    "split": "committed_atomically",
    "undo_by_operation_id": "requested_operation_undone",
    "independent_scope_undo": "independently_undone",
    "dependency_blocks_prior_undo": "rejected_without_partial_commit",
    "undo_lock_version_monotonic": "advanced_and_stale_rejected",
    "overlapping_formal_maintenance_blocks_undo": "rejected_without_partial_commit",
    "formal_maintenance_optimistic_conflict": "exactly_one_commit",
    "injected_failure_rollback": "rolled_back",
}

RESTORE_ATTACK_CASES = {
    "no_token",
    "wrong_token",
    "revoked_token",
    "client_a_modifies_client_b",
    "write_figure_prototype",
    "write_figure_version",
    "replace_formal_main_image",
    "generic_rest_crud_bypass",
    "local_api_bypass",
    "admin_generic_save_bypass",
    "out_of_scope_review_target",
    "completed_work_item_mutation",
}

STANDALONE_ATTACK_CASES = {
    "no_token_candidate_upsert",
    "wrong_token_candidate_upsert",
    "revoked_token_candidate_upsert",
    "candidate_write_figure_prototype_rest",
    "candidate_write_figure_version_rest",
    "candidate_replace_main_image_rest",
    "candidate_generic_crud_rest",
    "candidate_graphql_formal_write",
    "unauthenticated_admin_formal_create",
    "candidate_custom_domain_endpoint",
}

ATTACK_INVARIANTS = {
    "formal_state_unchanged",
    "main_image_unchanged",
    "operation_log_unchanged",
}

HARD_GATES = {"PG-03", "PG-04", "PG-05", "PG-08", "PG-11", "PG-12", "PG-14"}


class EvidenceError(ValueError):
    """A sanitized stage is missing or does not prove its claimed result."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvidenceError(message)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"{path.name} root must be an object")
    return value


def assert_sanitized(value: Any, *, source: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if SENSITIVE_KEY.search(str(key)):
                raise ValueError(f"sensitive key {key!r} found in {source}")
            assert_sanitized(child, source=source)
    elif isinstance(value, list):
        for child in value:
            assert_sanitized(child, source=source)
    serialized = json.dumps(value, sort_keys=True)
    for pattern in SECRET_PATTERNS:
        if pattern.search(serialized):
            raise ValueError(f"credential-like content found in {source}")


def require_keys(value: Mapping[str, Any], keys: set[str], label: str) -> None:
    missing = sorted(keys - set(value))
    require(not missing, f"{label} missing required keys: {', '.join(missing)}")


def require_schema(document: Mapping[str, Any], label: str) -> None:
    require(document.get("schema_version") == 1, f"{label} schema_version must be 1")


def integer(value: Any, label: str, *, minimum: int = 0) -> int:
    require(isinstance(value, int) and not isinstance(value, bool), f"{label} must be an integer")
    require(value >= minimum, f"{label} must be at least {minimum}")
    return value


def nonempty_string(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value.strip()), f"{label} must be a non-empty string")
    return value.strip()


def sha256(value: Any, label: str) -> str:
    text = nonempty_string(value, label)
    require(bool(SHA256.fullmatch(text)), f"{label} must be a lowercase SHA-256 digest")
    return text


def mapping(value: Any, label: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{label} must be an object")
    return value


def sequence(value: Any, label: str) -> list[Any]:
    require(isinstance(value, list), f"{label} must be an array")
    return value


def true_fields(value: Any, fields: set[str], label: str) -> None:
    document = mapping(value, label)
    require_keys(document, fields, label)
    for field in fields:
        require(document[field] is True, f"{label}.{field} must be true")


def exact_test_result(
    value: Any,
    label: str,
    *,
    passed: int,
    failed: int = 0,
    skipped: int | None = 0,
) -> None:
    result = mapping(value, label)
    require_keys(result, {"passed", "failed"}, label)
    require(integer(result["passed"], f"{label}.passed") == passed, f"{label}.passed must be {passed}")
    require(integer(result["failed"], f"{label}.failed") == failed, f"{label}.failed must be {failed}")
    if skipped is not None:
        require_keys(result, {"skipped"}, label)
        require(
            integer(result["skipped"], f"{label}.skipped") == skipped,
            f"{label}.skipped must be {skipped}",
        )
        require_keys(result, {"total"}, label)
        require(
            integer(result["total"], f"{label}.total") == passed + failed + skipped,
            f"{label}.total does not match passed/failed/skipped",
        )


def require_document(documents: Mapping[str, dict[str, Any]], filename: str) -> dict[str, Any]:
    require(filename in documents, f"missing required result file: {filename}")
    document = documents[filename]
    require_schema(document, filename)
    return document


def validate_environment(document: Mapping[str, Any]) -> None:
    require_schema(document, "environment.json")
    require(document.get("runner") == "ubuntu-24.04", "environment runner must be ubuntu-24.04")
    hosted_image = mapping(document.get("hosted_image"), "environment.json.hosted_image")
    require_keys(hosted_image, {"os", "version"}, "environment.json.hosted_image")
    for field in ("os", "version"):
        nonempty_string(hosted_image[field], f"environment.json.hosted_image.{field}")
    linux = mapping(document.get("linux_checks"), "environment.json.linux_checks")
    true_fields(
        linux,
        {"case_sensitive_filesystem", "script_executable"},
        "environment.json.linux_checks",
    )
    require(linux.get("line_endings") == "LF", "Linux gate script line endings were not LF")
    require(linux.get("path_separator") == "/", "Linux path separator was not POSIX")
    nonempty_string(linux.get("temporary_directory"), "Linux runner temporary directory")
    nonempty_string(linux.get("timezone"), "Linux runner timezone")
    versions = mapping(document.get("versions"), "environment.json.versions")
    expected = {
        "ubuntu",
        "cpu",
        "cpu_cores",
        "memory_bytes",
        "available_disk_bytes",
        "docker_client",
        "docker_server",
        "docker_compose",
        "node",
        "npm",
        "python",
    }
    require_keys(versions, expected, "environment.json.versions")
    require(versions["node"] == "v22.23.1", "Node version must be v22.23.1")
    require(nonempty_string(versions["python"], "Python version").startswith("Python 3.10."), "Python must be 3.10.x")
    for field in expected - {"cpu_cores", "memory_bytes", "available_disk_bytes"}:
        nonempty_string(versions[field], f"environment.json.versions.{field}")
    for field in ("cpu_cores", "memory_bytes", "available_disk_bytes"):
        raw = versions[field]
        if isinstance(raw, str):
            require(raw.isdigit(), f"environment.json.versions.{field} must be numeric")
            raw = int(raw)
        integer(raw, f"environment.json.versions.{field}", minimum=1)


def validate_infrastructure(document: Mapping[str, Any]) -> None:
    require_schema(document, "infrastructure.json")
    require(document.get("postgres_health") == "healthy", "PostgreSQL was not healthy")
    require(document.get("minio_health") == "healthy", "MinIO was not healthy")
    require(document.get("non_loopback_probe") == "refused", "non-loopback probe was not refused")
    require(
        set(sequence(document.get("loopback_bindings"), "infrastructure.json.loopback_bindings"))
        == {"127.0.0.1:55432", "127.0.0.1:59000", "127.0.0.1:59001"},
        "infrastructure loopback bindings differ from the three allowed ports",
    )
    images = mapping(document.get("images"), "infrastructure.json.images")
    expected = {
        "postgres": "postgres:16.9-bookworm",
        "minio": "minio/minio:RELEASE.2025-04-22T22-12-26Z",
        "mc": "minio/mc:RELEASE.2025-04-16T18-13-26Z",
    }
    require(set(images) == set(expected), "infrastructure image set is not exact")
    for name, image_ref in expected.items():
        image = mapping(images[name], f"infrastructure.json.images.{name}")
        require_keys(image, {"ref", "id", "digest"}, f"infrastructure.json.images.{name}")
        require(image["ref"] == image_ref, f"{name} image reference changed")
        require(bool(IMAGE_ID.fullmatch(str(image["id"]))), f"{name} image ID is not immutable")
        require(bool(IMAGE_DIGEST.fullmatch(str(image["digest"]))), f"{name} image digest is not immutable")


def validate_run_and_cleanup(documents: Mapping[str, dict[str, Any]]) -> None:
    run = require_document(documents, "run-status.json")
    require(run.get("status") == "pass" and run.get("stage") == "complete", "gate run did not complete")
    cleanup = require_document(documents, "cleanup.json")
    require(cleanup.get("status") == "pass" and cleanup.get("stage") == "cleanup", "cleanup did not pass")
    require(integer(cleanup.get("containers_remaining"), "cleanup containers_remaining") == 0, "containers remain")
    require(integer(cleanup.get("volumes_remaining"), "cleanup volumes_remaining") == 0, "volumes remain")
    require(sequence(cleanup.get("listening_ports"), "cleanup listening_ports") == [], "gate ports remain open")
    true_fields(
        cleanup,
        {
            "runtime_env_removed",
            "backup_removed",
            "temporary_objects_removed",
            "work_dir_removed",
            "restored_next_removed",
            "checkout_media_absent",
        },
        "cleanup.json",
    )


def validate_schema_document(document: Mapping[str, Any], label: str) -> None:
    require_schema(document, label)
    require(document.get("adapter") == "postgres", f"{label} did not use PostgreSQL")
    require(integer(document.get("migration_count"), f"{label}.migration_count", minimum=1) >= 1, f"{label} has no migration")
    require(integer(document.get("required_table_checks"), f"{label}.required_table_checks") == 9, f"{label} table checks must be 9")
    require(integer(document.get("required_column_checks"), f"{label}.required_column_checks") == 13, f"{label} column checks must be 13")
    require(integer(document.get("unique_index_checks"), f"{label}.unique_index_checks") == 3, f"{label} unique index checks must be 3")
    require(integer(document.get("foreign_key_checks"), f"{label}.foreign_key_checks") == 5, f"{label} foreign key checks must be 5")
    migration_names = sequence(document.get("migration_names"), f"{label}.migration_names")
    require(len(migration_names) == document["migration_count"], f"{label} migration names/count differ")
    require(all(isinstance(name, str) and name for name in migration_names), f"{label} has an invalid migration name")
    migration_batches = sequence(document.get("migration_batches"), f"{label}.migration_batches")
    require(len(migration_batches) == document["migration_count"], f"{label} migration batches/count differ")
    for index, batch in enumerate(migration_batches):
        integer(batch, f"{label}.migration_batches[{index}]", minimum=1)
    require(
        set(sequence(document.get("checked_tables"), f"{label}.checked_tables"))
        == EXPECTED_SCHEMA_TABLES,
        f"{label} checked table identities are incomplete",
    )
    require(
        set(sequence(document.get("checked_columns"), f"{label}.checked_columns"))
        == EXPECTED_SCHEMA_COLUMNS,
        f"{label} checked column identities are incomplete",
    )
    require(
        set(sequence(document.get("checked_unique_indexes"), f"{label}.checked_unique_indexes"))
        == EXPECTED_SCHEMA_UNIQUE_INDEXES,
        f"{label} checked unique-index identities are incomplete",
    )
    require(
        set(sequence(document.get("checked_foreign_keys"), f"{label}.checked_foreign_keys"))
        == EXPECTED_SCHEMA_FOREIGN_KEYS,
        f"{label} checked foreign-key identities are incomplete",
    )


def validate_migration_gate(
    document: Mapping[str, Any],
    label: str,
    *,
    mode: str,
    expected_names: list[Any],
) -> None:
    require_schema(document, label)
    require(document.get("status") == "pass", f"{label} did not pass")
    require(document.get("mode") == mode, f"{label} mode must be {mode}")
    require(document.get("migration_engine") == "payload.db.migrate", f"{label} did not use Payload's migration engine")
    configured = sequence(document.get("configured_migrations"), f"{label}.configured_migrations")
    require(configured == expected_names, f"{label} configured migration names differ from schema audit")
    before = mapping(document.get("before"), f"{label}.before")
    after = mapping(document.get("after"), f"{label}.after")

    def migration_rows(state: Mapping[str, Any], state_label: str) -> list[dict[str, Any]]:
        rows = [mapping(row, f"{state_label}.migrations[]") for row in sequence(state.get("migrations"), f"{state_label}.migrations")]
        names: list[str] = []
        for index, row in enumerate(rows):
            require_keys(row, {"name", "batch"}, f"{state_label}.migrations[{index}]")
            names.append(nonempty_string(row["name"], f"{state_label}.migrations[{index}].name"))
            integer(row["batch"], f"{state_label}.migrations[{index}].batch", minimum=1)
        require(len(names) == len(set(names)), f"{state_label} contains duplicate migration names")
        require(set(names) <= set(expected_names), f"{state_label} contains an unknown migration")
        return rows

    before_rows = migration_rows(before, f"{label}.before")
    after_rows = migration_rows(after, f"{label}.after")
    added = sequence(document.get("added_migrations"), f"{label}.added_migrations")
    if mode == "fresh":
        require(before.get("migration_table_exists") is False, f"{label} did not begin without a migration table")
        require(before_rows == [], f"{label} fresh state already had migration rows")
        require(after.get("migration_table_exists") is True, f"{label} did not create the migration table")
        require(sorted(str(row["name"]) for row in after_rows) == expected_names, f"{label} did not apply the exact configured migrations")
        require(added == expected_names, f"{label} fresh migration delta is not exact")
    else:
        require(before.get("migration_table_exists") is True and after.get("migration_table_exists") is True, f"{label} repeat migration table was absent")
        require(before == after, f"{label} repeat migration changed migration records")
        require(sorted(str(row["name"]) for row in before_rows) == expected_names, f"{label} repeat migration names are incomplete")
        require(added == [], f"{label} repeat migration added records")


def validate_pg01(documents: Mapping[str, dict[str, Any]]) -> None:
    schemas = [require_document(documents, name) for name in ("schema-first.json", "schema-repeat.json")]
    for name, document in zip(("schema-first.json", "schema-repeat.json"), schemas, strict=True):
        validate_schema_document(document, name)
    signature_fields = (
        "migration_count",
        "migration_names",
        "migration_batches",
        "required_table_checks",
        "required_column_checks",
        "unique_index_checks",
        "foreign_key_checks",
        "checked_tables",
        "checked_columns",
        "checked_unique_indexes",
        "checked_foreign_keys",
    )
    require(
        all(schemas[0].get(field) == schemas[1].get(field) for field in signature_fields),
        "repeat migration changed the audited schema signature",
    )
    expected_names = sorted(sequence(schemas[0].get("migration_names"), "schema-first.json.migration_names"))
    validate_migration_gate(
        require_document(documents, "migration-fresh.json"),
        "migration-fresh.json",
        mode="fresh",
        expected_names=expected_names,
    )
    validate_migration_gate(
        require_document(documents, "migration-repeat.json"),
        "migration-repeat.json",
        mode="repeat",
        expected_names=expected_names,
    )
    seed = require_document(documents, "migration-seed.json")
    require(seed.get("fresh_migration") == "pass", "fresh migration failed")
    require(seed.get("migration_status") == "pass", "migration status command failed")
    require(seed.get("repeat_migration") == "pass", "repeat migration failed")


def validate_pg02(documents: Mapping[str, dict[str, Any]]) -> None:
    seed = require_document(documents, "migration-seed.json")
    require(seed.get("repeat_seed") == "pass", "repeat seed was not idempotent")
    require(integer(seed.get("difference_count"), "migration-seed difference_count") == 0, "repeat seed differs")
    first = mapping(seed.get("collection_counts_first"), "migration-seed collection_counts_first")
    second = mapping(seed.get("collection_counts_second"), "migration-seed collection_counts_second")
    require(EXPECTED_COLLECTIONS <= set(first), "first seed omitted required collections")
    require(set(first) == set(second), "seed collection sets differ")
    require(first == second, "repeat seed changed collection counts")
    for name, value in first.items():
        integer(value, f"seed count {name}")
    for name in EXPECTED_COLLECTIONS - {"review-work-items"}:
        require(integer(first[name], f"seed count {name}") >= 1, f"seed unexpectedly left {name} empty")
    first_digest = sha256(seed.get("first_digest"), "migration-seed first_digest")
    require(first_digest == sha256(seed.get("second_digest"), "migration-seed second_digest"), "repeat seed digest differs")
    require(seed.get("existing_main_image_preserved") is True, "repeat seed replaced a selected main image")
    require(
        integer(seed.get("system_settings_count_first"), "first system setting count", minimum=1)
        == integer(seed.get("system_settings_count_second"), "second system setting count", minimum=1),
        "repeat seed changed the SystemSetting count",
    )
    require(
        sha256(seed.get("settings_digest_first"), "first settings digest")
        == sha256(seed.get("settings_digest_second"), "second settings digest"),
        "repeat seed changed SystemSetting",
    )


def validate_regressions(document: Mapping[str, Any]) -> None:
    require_schema(document, "regressions.json")
    fixture = mapping(document.get("fixture"), "regressions.json.fixture")
    require(fixture.get("status") == "pass", "shared fixture check failed")
    sha256(fixture.get("sha256"), "shared fixture digest")
    require(bool(mapping(fixture.get("counts"), "shared fixture counts")), "shared fixture counts are empty")
    exact_test_result(document.get("shared_contract"), "shared contract", passed=78)
    exact_test_result(document.get("sqlite"), "SQLite regression", passed=45, skipped=8)
    exact_test_result(document.get("postgres_integration"), "PostgreSQL integration", passed=30)
    exact_test_result(document.get("postgres_concurrency_and_rollback"), "PostgreSQL transaction", passed=8)
    for key in ("typecheck", "eslint"):
        require(document.get(key) == "pass", f"regressions.json {key} did not pass")
    guard = mapping(document.get("hpoi_guard"), "regressions.json.hpoi_guard")
    require(guard.get("status") == "pass", "Hpoi guard did not pass")
    require(integer(guard.get("python_transport_calls"), "Python Hpoi transport calls") == 0, "Python Hpoi transport was called")
    require(integer(guard.get("typescript_transport_calls"), "TypeScript Hpoi transport calls") == 0, "TypeScript Hpoi transport was called")
    require(integer(document.get("hpoi_requests"), "Hpoi request count") == 0, "Hpoi request count was not zero")


def validate_transaction_concurrency(document: Mapping[str, Any]) -> None:
    require_schema(document, "transaction-concurrency.json")
    require(document.get("status") == "pass", "transaction/concurrency stage did not pass")
    validate_named_cases(
        document,
        set(TRANSACTION_OUTCOMES),
        "transaction-concurrency.json",
        outcome=TRANSACTION_OUTCOMES,
    )
    true_fields(
        document.get("invariants"),
        {
            "no_partial_commit",
            "no_broken_relationships",
            "no_duplicate_sources",
            "no_orphaned_media",
            "operation_log_consistent",
            "exactly_one_optimistic_writer",
            "lock_versions_monotonic",
            "overlapping_scope_dependency_enforced",
            "formal_maintenance_conflict_explicit",
        },
        "transaction-concurrency.json.invariants",
    )


def validate_named_cases(
    document: Mapping[str, Any],
    expected_names: set[str],
    label: str,
    *,
    outcome: str | Mapping[str, str],
    require_attack_invariants: bool = False,
) -> None:
    cases = sequence(document.get("cases"), f"{label}.cases")
    require(integer(document.get("case_count"), f"{label}.case_count") == len(expected_names), f"{label} case_count is not exact")
    require(integer(document.get("passed"), f"{label}.passed") == len(expected_names), f"{label} passed count is not exact")
    require(integer(document.get("failed"), f"{label}.failed") == 0, f"{label} has failed cases")
    require(len(cases) == len(expected_names), f"{label} case array length is not exact")
    names: list[str] = []
    for index, raw_case in enumerate(cases):
        case = mapping(raw_case, f"{label}.cases[{index}]")
        require_keys(
            case,
            {"name", "status", "expected_outcome", "actual_outcome", "evidence"},
            f"{label}.cases[{index}]",
        )
        name = nonempty_string(case["name"], f"{label}.cases[{index}].name")
        names.append(name)
        nonempty_string(case["evidence"], f"{label} case {name} evidence")
        require(case["status"] == "pass", f"{label} case {name} did not pass")
        expected_outcome = outcome.get(name) if isinstance(outcome, Mapping) else outcome
        require(expected_outcome is not None, f"{label} case {name} is not recognized")
        require(case["expected_outcome"] == expected_outcome, f"{label} case {name} has an unexpected expectation")
        require(case["actual_outcome"] == expected_outcome, f"{label} case {name} did not produce its expected outcome")
        if require_attack_invariants:
            nonempty_string(case.get("surface"), f"{label} case {name} surface")
            true_fields(case.get("invariants"), ATTACK_INVARIANTS, f"{label} case {name} invariants")
    require(set(names) == expected_names and len(names) == len(set(names)), f"{label} case names are incomplete or duplicated")


def validate_pg03(documents: Mapping[str, dict[str, Any]]) -> None:
    regressions = require_document(documents, "regressions.json")
    validate_regressions(regressions)
    validate_transaction_concurrency(require_document(documents, "transaction-concurrency.json"))


def validate_backup_restore(document: Mapping[str, Any]) -> None:
    require_schema(document, "backup-restore.json")
    require(document.get("status") == "pass", "database backup/restore did not pass")
    require(document.get("backup_format") == "PostgreSQL custom", "backup was not PostgreSQL custom format")
    require(document.get("pg_dump") == "pass", "database backup did not use pg_dump successfully")
    require(document.get("pg_restore") == "pass", "database restore did not use pg_restore successfully")
    sha256(document.get("backup_sha256"), "database backup SHA-256")
    integer(document.get("backup_size_bytes"), "database backup size", minimum=1)
    integer(document.get("backup_restore_ms"), "database backup/restore duration", minimum=1)
    integer(document.get("table_count"), "database backup table count", minimum=1)
    integer(document.get("record_count"), "database backup record count", minimum=1)
    require(document.get("database_dropped") is True, "original database was not dropped")
    require(document.get("empty_database_created") is True, "empty database was not created")
    require(document.get("backup_deleted") is True, "temporary database backup was not deleted")
    require(integer(document.get("difference_count"), "database restore difference_count") == 0, "restored database differs")
    require(sha256(document.get("before_digest"), "database before digest") == sha256(document.get("after_digest"), "database after digest"), "restore data digest differs")
    require(
        sha256(document.get("relation_digest_before"), "relation digest before")
        == sha256(document.get("relation_digest_after"), "relation digest after"),
        "restore relation digest differs",
    )
    before_counts = mapping(document.get("counts_before"), "backup counts_before")
    require(before_counts == mapping(document.get("counts_after"), "backup counts_after"), "restore collection counts differ")
    snapshot_id = nonempty_string(document.get("snapshot_id"), "database/object snapshot ID")
    expected_sha = os.environ.get("GITHUB_SHA")
    if expected_sha:
        require(expected_sha in snapshot_id, "database/object snapshot ID is not bound to GITHUB_SHA")
    sha256(document.get("object_manifest_sha256"), "database/object manifest digest")
    before_objects = integer(document.get("object_count_before"), "object count before restore", minimum=1)
    require(integer(document.get("object_count_after"), "object count after restore") == before_objects, "object count changed across restore")
    require(document.get("object_purge_empty") is True, "object prefix was not empty during restore drill")
    require(document.get("object_restore_sha256_verified") is True, "restored object hashes were not verified")
    object_audit = mapping(document.get("object_database_audit"), "backup object/database audit")
    require(sequence(object_audit.get("missing"), "backup object audit missing") == [], "restored object audit has missing keys")
    require(sequence(object_audit.get("orphaned"), "backup object audit orphaned") == [], "restored object audit has orphaned keys")
    require(integer(object_audit.get("expected_count"), "backup object audit expected") == before_objects, "restored expected object count differs")
    require(integer(object_audit.get("actual_count"), "backup object audit actual") == before_objects, "restored actual object count differs")


def validate_pg04(documents: Mapping[str, dict[str, Any]]) -> None:
    backup = require_document(documents, "backup-restore.json")
    validate_backup_restore(backup)
    restored_snapshot_id = validate_restored_joint_smoke(
        require_document(documents, "restored-joint-smoke.json")
    )
    require(backup.get("snapshot_id") == restored_snapshot_id, "restored Payload contract used a different snapshot")


def validate_attack_matrix(document: Mapping[str, Any], expected: set[str], label: str) -> None:
    require_schema(document, label)
    require(document.get("status") == "pass", f"{label} did not pass")
    validate_named_cases(
        document,
        expected,
        label,
        outcome="rejected",
        require_attack_invariants=True,
    )


def validate_restore_regressions(document: Mapping[str, Any]) -> str:
    require_schema(document, "restore-regressions.json")
    require(document.get("status") == "pass", "post-restore regressions did not pass")
    require(document.get("synthetic_fixture_check") == "pass", "post-restore synthetic fixture check failed")
    sha256(document.get("fixture_sha256"), "post-restore fixture digest")
    exact_test_result(document.get("shared_contract"), "restored shared contract", passed=78)
    execution = mapping(document.get("execution"), "restore-regressions.json.execution")
    require(execution.get("phase") == "post_restore", "restored regressions used the wrong execution phase")
    require(execution.get("database_adapter") == "postgres", "restored regressions did not use PostgreSQL")
    require(execution.get("object_store") == "s3", "restored regressions did not use S3")
    require(execution.get("s3_endpoint_scope") == "loopback", "restored regressions did not use loopback S3")
    require(execution.get("payload_contract_status") == "pass", "restored Payload contract did not pass")
    require(execution.get("payload_contract_evidence") == "restored-joint-smoke.json", "restored Payload contract evidence differs")
    require(integer(execution.get("service_endpoint_count"), "restored service endpoint count") == 10, "restored service endpoint count differs")
    require(execution.get("service_endpoints_all_200") is True, "restored service contract was not all HTTP 200")
    snapshot_id = nonempty_string(execution.get("snapshot_id"), "restored regression snapshot ID")
    expected_sha = os.environ.get("GITHUB_SHA")
    if expected_sha:
        require(expected_sha in snapshot_id, "restored regression snapshot is not bound to GITHUB_SHA")
    attacks = mapping(document.get("attacks"), "restore-regressions.json.attacks")
    validate_attack_matrix(attacks, RESTORE_ATTACK_CASES, "restore-regressions.json.attacks")
    features = mapping(document.get("features"), "restore-regressions.json.features")
    require(set(features) == RESTORE_ATTACK_CASES, "post-restore feature/case set is not exact")
    true_fields(features, RESTORE_ATTACK_CASES, "restore-regressions.json.features")
    return snapshot_id


def validate_pg05(documents: Mapping[str, dict[str, Any]]) -> None:
    backup = require_document(documents, "backup-restore.json")
    validate_backup_restore(backup)
    regression_snapshot_id = validate_restore_regressions(
        require_document(documents, "restore-regressions.json")
    )
    restored_snapshot_id = validate_restored_joint_smoke(
        require_document(documents, "restored-joint-smoke.json")
    )
    require(backup.get("snapshot_id") == regression_snapshot_id, "restored attacks used a different snapshot")
    require(restored_snapshot_id == regression_snapshot_id, "restored runtime and attacks used different snapshots")


def validate_media_wrapper(document: Mapping[str, Any], filename: str, mode: str) -> dict[str, Any]:
    require_schema(document, filename)
    require(document.get("component") == "payload-postgres-minio-media", f"{filename} component mismatch")
    require(document.get("status") == "pass" and document.get("mode") == mode, f"{filename} did not pass")
    return mapping(document.get("details"), f"{filename}.details")


def validate_media_setup(document: Mapping[str, Any]) -> None:
    details = validate_media_wrapper(document, "media-setup.json", "setup")
    require(integer(details.get("candidates_created"), "media setup candidates") == 3, "media setup must create exactly 3 candidates")
    true_fields(
        details,
        {"client_identity_created", "different_content_same_source_url_distinct", "same_content_deduplicated", "seed_completed"},
        "media-setup.json.details",
    )
    require(set(sequence(details.get("synthetic_images"), "media setup synthetic_images")) == {"PNG", "JPEG"}, "media setup image formats must be PNG and JPEG")
    integer(details.get("png_media_id"), "PNG media ID", minimum=1)
    integer(details.get("jpeg_media_id"), "JPEG media ID", minimum=1)


def validate_image_detail(value: Any, label: str) -> None:
    detail = mapping(value, label)
    require_keys(detail, {"key", "byte_size", "format", "height", "sha256", "width"}, label)
    key = nonempty_string(detail["key"], f"{label}.key")
    require("://" not in key and "\\" not in key, f"{label}.key must be a storage key")
    integer(detail["byte_size"], f"{label}.byte_size", minimum=1)
    integer(detail["height"], f"{label}.height", minimum=1)
    integer(detail["width"], f"{label}.width", minimum=1)
    sha256(detail["sha256"], f"{label}.sha256")
    nonempty_string(detail["format"], f"{label}.format")


def validate_media_audit(document: Mapping[str, Any]) -> None:
    details = validate_media_wrapper(document, "media-audit.json", "audit")
    require(details.get("repeated_reads_stable") is True, "repeated object reads were not stable")
    require(details.get("storage_key_excludes_endpoint_and_public_url") is True, "storage key depends on a URL")
    media = sequence(details.get("media"), "media-audit.json.details.media")
    require(len(media) >= 2, "media audit must inspect at least PNG and JPEG")
    formats: set[str] = set()
    for index, raw_item in enumerate(media):
        item = mapping(raw_item, f"media audit item {index}")
        integer(item.get("media_id"), f"media audit item {index} ID", minimum=1)
        original = mapping(item.get("original"), f"media audit item {index} original")
        validate_image_detail(original, f"media audit item {index} original")
        perceptual_hash = nonempty_string(
            original.get("perceptual_hash"),
            f"media audit item {index} original perceptual_hash",
        )
        require(
            bool(AHASH.fullmatch(perceptual_hash)),
            f"media audit item {index} original perceptual_hash must be a lowercase 64-bit aHash",
        )
        formats.add(str(original.get("format")).lower())
        sizes = mapping(item.get("sizes"), f"media audit item {index} sizes")
        require(set(sizes) == {"thumbnail", "preview"}, f"media audit item {index} derivative set is not exact")
        validate_image_detail(sizes["thumbnail"], f"media audit item {index} thumbnail")
        validate_image_detail(sizes["preview"], f"media audit item {index} preview")
        storage_key = nonempty_string(item.get("storage_key"), f"media audit item {index} storage_key")
        require("://" not in storage_key and "\\" not in storage_key, "media storage key contains a URL or Windows separator")
    require({"png", "jpeg"} <= formats, "media audit did not cover both PNG and JPEG")
    audit = mapping(details.get("object_audit"), "media object audit")
    expected = integer(audit.get("expected_count"), "media expected object count", minimum=6)
    require(integer(audit.get("actual_count"), "media actual object count") == expected, "media object counts differ")
    require(sequence(audit.get("missing"), "media missing objects") == [], "media audit has missing objects")
    require(sequence(audit.get("orphaned"), "media orphaned objects") == [], "media audit has orphaned objects")


def validate_pg06(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_media_setup(require_document(documents, "media-setup.json"))
    validate_media_audit(require_document(documents, "media-audit.json"))


def validate_lifecycle(document: Mapping[str, Any]) -> None:
    details = validate_media_wrapper(document, "media-lifecycle.json", "lifecycle")
    true_fields(
        details,
        {
            "candidate_soft_deleted",
            "main_image_object_retained",
            "missing_original_rebuild_refused",
            "orphan_detection_probe",
            "source_invalidated_and_soft_deleted",
        },
        "media-lifecycle.json.details",
    )
    integer(details.get("formal_main_image_id"), "formal main image ID", minimum=1)
    rebuilt = mapping(details.get("derivative_rebuild"), "media lifecycle derivative rebuild")
    require_keys(rebuilt, {"key", "byte_size", "sha256"}, "media lifecycle derivative rebuild")
    safe_storage_key(rebuilt["key"], "media lifecycle derivative rebuild key")
    integer(rebuilt["byte_size"], "media lifecycle derivative rebuild size", minimum=1)
    sha256(rebuilt["sha256"], "media lifecycle derivative rebuild digest")
    audit = mapping(details.get("final_object_audit"), "media lifecycle final object audit")
    require(sequence(audit.get("missing"), "lifecycle missing objects") == [], "lifecycle audit has missing objects")
    require(sequence(audit.get("orphaned"), "lifecycle orphaned objects") == [], "lifecycle audit has orphaned objects")
    require(integer(audit.get("actual_count"), "lifecycle actual objects", minimum=1) == integer(audit.get("expected_count"), "lifecycle expected objects", minimum=1), "lifecycle object counts differ")


def validate_pg07(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_media_audit(require_document(documents, "media-audit.json"))
    validate_lifecycle(require_document(documents, "media-lifecycle.json"))


def safe_storage_key(value: Any, label: str) -> str:
    key = nonempty_string(value, label)
    require("://" not in key and "\\" not in key, f"{label} must be a POSIX storage key, not a URL")
    require(not key.startswith("/") and ".." not in key.split("/"), f"{label} is not a safe relative key")
    return key


def compact_json_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_object_recovery_stages(documents: Mapping[str, dict[str, Any]]) -> str:
    backup = validate_media_wrapper(
        require_document(documents, "media-backup-manifest.json"),
        "media-backup-manifest.json",
        "backup-manifest",
    )
    purge = validate_media_wrapper(
        require_document(documents, "media-purge.json"),
        "media-purge.json",
        "purge",
    )
    restore = validate_media_wrapper(
        require_document(documents, "media-restore.json"),
        "media-restore.json",
        "restore",
    )
    migration = validate_media_wrapper(
        require_document(documents, "media-migrate-prefix.json"),
        "media-migrate-prefix.json",
        "migrate-prefix",
    )
    snapshot_ids = {
        nonempty_string(stage.get("snapshot_id"), f"{label} snapshot_id")
        for label, stage in (
            ("object backup", backup),
            ("object purge", purge),
            ("object restore", restore),
            ("prefix migration", migration),
        )
    }
    require(len(snapshot_ids) == 1, "object recovery stages used different snapshot IDs")
    snapshot_id = next(iter(snapshot_ids))
    expected_sha = os.environ.get("GITHUB_SHA")
    if expected_sha:
        require(expected_sha in snapshot_id, "object recovery snapshot ID is not bound to GITHUB_SHA")

    backup_prefix = safe_storage_key(backup.get("backup_prefix"), "object backup prefix")
    entries = sequence(backup.get("entries"), "object backup entries")
    object_count = integer(backup.get("object_count"), "object backup count", minimum=1)
    require(len(entries) == object_count, "object backup entry/count mismatch")
    normalized_entries: list[dict[str, Any]] = []
    source_keys: set[str] = set()
    backup_keys: set[str] = set()
    for index, raw_entry in enumerate(entries):
        entry = mapping(raw_entry, f"object backup entry {index}")
        require_keys(
            entry,
            {"backup_etag", "backup_key", "byte_size", "content_type", "sha256", "source_etag", "source_key"},
            f"object backup entry {index}",
        )
        backup_key = safe_storage_key(entry["backup_key"], f"object backup entry {index} backup_key")
        source_key = safe_storage_key(entry["source_key"], f"object backup entry {index} source_key")
        require(backup_key.startswith(f"{backup_prefix}/"), f"object backup entry {index} is outside backup prefix")
        require(not source_key.startswith(f"{backup_prefix}/"), f"object backup entry {index} source overlaps backup prefix")
        require(backup_key not in backup_keys and source_key not in source_keys, "object backup manifest has duplicate keys")
        backup_keys.add(backup_key)
        source_keys.add(source_key)
        integer(entry["byte_size"], f"object backup entry {index} byte_size", minimum=1)
        nonempty_string(entry["content_type"], f"object backup entry {index} content_type")
        sha256(entry["sha256"], f"object backup entry {index} sha256")
        nonempty_string(entry["backup_etag"], f"object backup entry {index} backup_etag")
        nonempty_string(entry["source_etag"], f"object backup entry {index} source_etag")
        normalized_entries.append(dict(entry))
    manifest_digest = sha256(backup.get("manifest_sha256"), "object backup manifest digest")
    require(compact_json_sha256(normalized_entries) == manifest_digest, "object backup manifest digest is not reproducible")

    require(purge.get("business_prefix_empty") is True, "business object prefix was not emptied")
    require(purge.get("recovery_phase") == "purged", "object purge did not reach purged phase")
    require(integer(purge.get("deleted_object_count"), "purged object count") == object_count, "purged object count differs from manifest")
    require(integer(purge.get("deleted_in_this_attempt"), "objects deleted in purge") == object_count, "fresh purge did not delete the full manifest")
    require(sha256(purge.get("manifest_sha256"), "purge manifest digest") == manifest_digest, "purge used a different manifest")

    require(restore.get("backup_prefix_empty") is True, "object backup prefix was not cleaned after restore")
    require(integer(restore.get("backup_objects_deleted"), "deleted backup objects") == object_count, "object backup cleanup count differs")
    require(integer(restore.get("restored_object_count"), "restored object count") == object_count, "restored object count differs")
    require(restore.get("restored_sha256_verified") is True, "restored object hashes were not verified")
    require(sha256(restore.get("manifest_sha256"), "restore manifest digest") == manifest_digest, "restore used a different manifest")
    audit = mapping(restore.get("database_object_audit"), "restored database/object audit")
    require(sequence(audit.get("missing"), "restored missing objects") == [], "restored objects are missing")
    require(sequence(audit.get("orphaned"), "restored orphaned objects") == [], "restored objects contain orphans")
    require(integer(audit.get("expected_count"), "restored expected objects") == object_count, "restored expected count differs")
    require(integer(audit.get("actual_count"), "restored actual objects") == object_count, "restored actual count differs")
    return snapshot_id


def validate_pg08(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_lifecycle(require_document(documents, "media-lifecycle.json"))


def validate_pg09(documents: Mapping[str, dict[str, Any]]) -> None:
    outage = validate_media_wrapper(require_document(documents, "media-outage.json"), "media-outage.json", "outage")
    require(integer(outage.get("database_media_delta"), "outage media delta") == 0, "MinIO outage left a media row")
    require(integer(outage.get("operation_log_delta"), "outage operation log delta") == 0, "MinIO outage wrote a success log")
    require(outage.get("main_image_unchanged") is True, "MinIO outage changed the formal main image")
    require(outage.get("formal_read_failed_explicitly") is True, "MinIO outage did not produce an explicit formal read failure")
    require(outage.get("formal_read_false_success") is False, "MinIO outage returned a false formal-image read success")
    status = integer(outage.get("upload_http_status"), "outage upload HTTP status", minimum=100)
    require(status == 503, "MinIO outage upload did not return HTTP 503")
    require(
        outage.get("stable_error_code") == "candidate_media_storage_unavailable",
        "MinIO outage upload omitted the stable storage-unavailable error code",
    )
    require(outage.get("retryable") is True, "MinIO outage upload was not marked retryable")
    recover = validate_media_wrapper(require_document(documents, "media-recover.json"), "media-recover.json", "recover")
    require(recover.get("idempotent_retry") is True, "MinIO recovery retry was not idempotent")
    require(recover.get("service_recovered") is True, "MinIO service did not recover")
    require(recover.get("formal_read_recovered") is True, "formal main-image read did not recover")
    require(integer(recover.get("object_count_for_media"), "recovered object count") == 3, "recovered media does not have three objects")
    sha256(recover.get("original_sha256"), "recovered object SHA-256")
    compensation = mapping(
        recover.get("compensated_post_upload_fault"),
        "media-recover.json compensated post-upload fault",
    )
    true_fields(
        compensation,
        {
            "business_prefix_key_sets_equal",
            "candidate_images_unchanged",
            "compensated",
            "main_image_unchanged",
            "retryable",
        },
        "media-recover.json compensated post-upload fault",
    )
    require(compensation.get("fault_stage") == "after-operation-log-before-commit", "post-upload fault stage differs")
    require(integer(compensation.get("upload_http_status"), "post-upload fault HTTP status") == 503, "post-upload fault was not HTTP 503")
    require(compensation.get("stable_error_code") == "candidate_media_commit_failed", "post-upload fault error code differs")
    for field in (
        "database_media_delta",
        "formal_prototype_delta",
        "formal_version_delta",
        "operation_log_delta",
        "missing_count_after",
        "orphan_count_after",
    ):
        require(integer(compensation.get(field), f"post-upload fault {field}") == 0, f"post-upload fault {field} was not zero")
    before_count = integer(compensation.get("business_prefix_key_count_before"), "post-upload prefix count before", minimum=1)
    require(
        integer(compensation.get("business_prefix_key_count_after"), "post-upload prefix count after") == before_count,
        "post-upload compensation changed the business-prefix object count",
    )
    require(
        sha256(compensation.get("business_prefix_key_set_before_sha256"), "post-upload key-set digest before")
        == sha256(compensation.get("business_prefix_key_set_after_sha256"), "post-upload key-set digest after"),
        "post-upload compensation changed the business-prefix key set",
    )
    final_audit = mapping(recover.get("final_object_audit"), "media-recover.json final object audit")
    expected = integer(final_audit.get("expected_count"), "recovered final expected object count", minimum=1)
    require(integer(final_audit.get("actual_count"), "recovered final actual object count") == expected, "recovered final object counts differ")
    require(sequence(final_audit.get("missing"), "recovered final missing objects") == [], "recovered final audit has missing objects")
    require(sequence(final_audit.get("orphaned"), "recovered final orphaned objects") == [], "recovered final audit has orphaned objects")


def validate_prefix_migration(document: Mapping[str, Any]) -> None:
    details = validate_media_wrapper(document, "media-migrate-prefix.json", "migrate-prefix")
    require(details.get("source_objects_unchanged") is True, "prefix copy changed source objects")
    require(details.get("storage_key_reads_verified") is True, "copied objects were not read through storage-key mappings")
    require(details.get("public_url_inputs_used") is False, "prefix copy depended on a public URL")
    require(details.get("migrated_prefix_cleaned") is True, "temporary migrated prefix was not cleaned")
    mappings = sequence(details.get("mappings"), "prefix copy mappings")
    count = integer(details.get("mapping_count"), "prefix copy mapping count", minimum=1)
    require(len(mappings) == count, "prefix copy mapping/count mismatch")
    source_keys: set[str] = set()
    migrated_keys: set[str] = set()
    normalized_mappings: list[dict[str, Any]] = []
    for index, raw_mapping in enumerate(mappings):
        item = mapping(raw_mapping, f"prefix mapping {index}")
        require_keys(
            item,
            {"byte_size", "migrated_etag", "migrated_key", "sha256", "source_etag", "source_key", "storage_key"},
            f"prefix mapping {index}",
        )
        source = safe_storage_key(item["source_key"], f"prefix mapping {index} source_key")
        migrated = safe_storage_key(item["migrated_key"], f"prefix mapping {index} migrated_key")
        storage = safe_storage_key(item["storage_key"], f"prefix mapping {index} storage_key")
        require(source != migrated, f"prefix mapping {index} did not copy to a new key")
        require(source.endswith(storage), f"prefix mapping {index} source key does not preserve storageKey")
        require(migrated.endswith(storage), f"prefix mapping {index} migrated key does not preserve storageKey")
        require(source not in source_keys and migrated not in migrated_keys, "prefix copy mappings contain duplicate keys")
        source_keys.add(source)
        migrated_keys.add(migrated)
        integer(item["byte_size"], f"prefix mapping {index} byte_size", minimum=1)
        sha256(item["sha256"], f"prefix mapping {index} sha256")
        nonempty_string(item["source_etag"], f"prefix mapping {index} source_etag")
        nonempty_string(item["migrated_etag"], f"prefix mapping {index} migrated_etag")
        normalized_mappings.append(dict(item))
    require(
        compact_json_sha256(normalized_mappings)
        == sha256(details.get("mapping_sha256"), "prefix mapping digest"),
        "prefix mapping digest is not reproducible",
    )


def validate_pg10(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_media_audit(require_document(documents, "media-audit.json"))
    validate_prefix_migration(require_document(documents, "media-migrate-prefix.json"))


def validate_standalone(document: Mapping[str, Any]) -> None:
    require_schema(document, "standalone.json")
    require(document.get("status") == "pass", "standalone stage did not pass")
    expected_sha = os.environ.get("GITHUB_SHA")
    source_sha = nonempty_string(document.get("clean_checkout_source_commit"), "standalone clean source commit")
    if expected_sha:
        require(source_sha == expected_sha, "standalone clean checkout did not use GITHUB_SHA")
    true_fields(
        document,
        {
            "git_archive",
            "lockfile_install",
            "standalone_assembled",
            "loopback_only",
            "postgres",
            "s3",
            "clean_checkout",
            "npm_ci",
            "fresh_database",
            "fresh_bucket",
            "data_persisted",
            "media_persisted",
        },
        "standalone.json",
    )
    for field in ("migration", "seed", "production_build"):
        require(document.get(field) == "pass", f"standalone {field} did not pass")
    require(document.get("nft_warning") is False, "standalone NFT warning remains")
    require(document.get("next_dev_used") is False, "standalone relied on next dev")
    integer(document.get("build_ms"), "standalone build duration", minimum=1)
    integer(document.get("sharp_runtime_file_count"), "Sharp runtime file count", minimum=1)
    require(integer(document.get("restart_difference_count"), "standalone restart difference_count") == 0, "standalone restart changed data")
    require(integer(document.get("initial_public_table_count"), "standalone initial table count") == 0, "standalone database was not initially empty")
    require(integer(document.get("initial_bucket_object_count"), "standalone initial object count") == 0, "standalone bucket was not initially empty")
    before_objects = integer(document.get("object_count_before_restart"), "standalone objects before restart", minimum=1)
    require(integer(document.get("object_count_after_restart"), "standalone objects after restart") == before_objects, "standalone restart changed object count")
    require(
        sha256(document.get("database_digest_before_restart"), "standalone database digest before restart")
        == sha256(document.get("database_digest_after_restart"), "standalone database digest after restart"),
        "standalone restart database digest differs",
    )
    require(
        sha256(document.get("media_digest_before_restart"), "standalone media digest before restart")
        == sha256(document.get("media_digest_after_restart"), "standalone media digest after restart"),
        "standalone restart media digest differs",
    )
    for phase in ("clean_start", "restart"):
        smoke = mapping(document.get(phase), f"standalone {phase}")
        require(smoke.get("phase") == phase, f"standalone {phase} phase marker differs")
        for endpoint in ("health", "root", "admin", "static", "original", "thumbnail", "preview"):
            require(integer(smoke.get(endpoint), f"standalone {phase} {endpoint}") == 200, f"standalone {phase} {endpoint} was not HTTP 200")
        protocol = mapping(smoke.get("candidate_protocol"), f"standalone {phase} candidate protocol")
        require(protocol == {"upsert": "pass", "upload": "pass"}, f"standalone {phase} candidate protocol is incomplete")
        require(integer(smoke.get("attack_case_count"), f"standalone {phase} attack count") == 10, f"standalone {phase} attack count differs")
        require(smoke.get("state_unchanged") is True, f"standalone {phase} attacks changed state")
        require(smoke.get("operation_log_unchanged") is True, f"standalone {phase} attacks changed OperationLog")
        require(smoke.get("graphql_rejected") is True, f"standalone {phase} GraphQL attack was not rejected")


def validate_restored_joint_smoke(document: Mapping[str, Any]) -> str:
    require_schema(document, "restored-joint-smoke.json")
    require(document.get("status") == "pass", "restored joint smoke did not pass")
    require(document.get("component") == "restored-postgres-s3-payload", "restored joint component differs")
    require(document.get("database_adapter") == "postgres", "restored joint smoke did not use PostgreSQL")
    require(document.get("object_store") == "s3", "restored joint smoke did not use S3")
    snapshot_id = nonempty_string(document.get("snapshot_id"), "restored joint snapshot ID")
    expected_sha = os.environ.get("GITHUB_SHA")
    if expected_sha:
        require(expected_sha in snapshot_id, "restored joint snapshot is not bound to GITHUB_SHA")

    service = mapping(document.get("service"), "restored joint service")
    require(service.get("loopback_only") is True, "restored joint service was not loopback-only")
    for endpoint in (
        "health",
        "home",
        "admin_login",
        "candidate_review_ui",
        "unique_search",
        "disambiguation_search",
        "adult_gallery",
        "original",
        "thumbnail",
        "preview",
    ):
        require(
            integer(service.get(endpoint), f"restored joint service {endpoint}") == 200,
            f"restored joint service {endpoint} was not HTTP 200",
        )

    checks = mapping(document.get("checks"), "restored joint checks")
    require(checks.get("snapshot_id") == snapshot_id, "restored joint nested snapshot ID differs")
    adult = mapping(checks.get("adult"), "restored joint adult check")
    require(adult.get("hidden_by_default") is True, "restored adult image was not hidden by default")
    integer(adult.get("character_id"), "restored adult character ID", minimum=1)
    integer(adult.get("prototype_id"), "restored adult prototype ID", minimum=1)
    nonempty_string(adult.get("main_filename"), "restored adult main filename")

    review = mapping(checks.get("candidate_review"), "restored joint candidate review")
    require(integer(review.get("audit_record_count"), "restored review audit count") == 1, "restored review audit count differs")
    require(review.get("lock_version_advanced") is True, "restored review optimistic lock did not advance")
    integer(review.get("work_item_id"), "restored review work item ID", minimum=1)

    formal = mapping(checks.get("formal_main"), "restored joint formal main")
    integer(formal.get("media_id"), "restored formal media ID", minimum=1)
    for field in ("original_key", "preview_key", "storage_key", "thumbnail_key"):
        safe_storage_key(formal.get(field), f"restored formal {field}")
    for field in ("original_sha256", "preview_sha256", "thumbnail_sha256"):
        sha256(formal.get(field), f"restored formal {field}")

    gallery = mapping(checks.get("gallery"), "restored joint gallery")
    require(integer(gallery.get("unique_match_count"), "restored unique match count") == 1, "restored unique search count differs")
    integer(gallery.get("ambiguous_match_count"), "restored ambiguous match count", minimum=2)
    integer(gallery.get("character_id"), "restored gallery character ID", minimum=1)
    integer(gallery.get("prototype_id"), "restored gallery prototype ID", minimum=1)
    nonempty_string(gallery.get("main_filename"), "restored gallery main filename")

    objects = mapping(checks.get("object_checks"), "restored joint object checks")
    true_fields(
        objects,
        {
            "derivative_missing_detected",
            "derivative_rebuilt",
            "missing_original_rebuild_refused",
            "orphan_detected",
        },
        "restored joint object checks",
    )
    audit = mapping(objects.get("final_audit"), "restored joint final object audit")
    expected = integer(audit.get("expected_count"), "restored joint expected objects", minimum=1)
    require(integer(audit.get("actual_count"), "restored joint actual objects") == expected, "restored joint object counts differ")
    require(sequence(audit.get("missing"), "restored joint missing objects") == [], "restored joint audit has missing objects")
    require(sequence(audit.get("orphaned"), "restored joint orphaned objects") == [], "restored joint audit has orphaned objects")

    source = mapping(checks.get("source"), "restored joint source")
    require(source.get("invalidated") is True and source.get("status") == "missing", "restored invalidated source state differs")
    integer(source.get("source_id"), "restored source ID", minimum=1)
    return snapshot_id


def validate_pg11(documents: Mapping[str, dict[str, Any]]) -> None:
    backup = require_document(documents, "backup-restore.json")
    validate_backup_restore(backup)
    object_snapshot_id = validate_object_recovery_stages(documents)
    object_manifest = validate_media_wrapper(
        require_document(documents, "media-backup-manifest.json"),
        "media-backup-manifest.json",
        "backup-manifest",
    )
    object_restore = validate_media_wrapper(
        require_document(documents, "media-restore.json"),
        "media-restore.json",
        "restore",
    )
    require(
        backup.get("object_manifest_sha256") == object_manifest.get("manifest_sha256"),
        "database/object joint restore used different object manifests",
    )
    require(
        backup.get("object_count_before") == object_manifest.get("object_count")
        and backup.get("object_count_after") == object_restore.get("restored_object_count"),
        "database/object joint restore object counts differ",
    )
    require(backup.get("snapshot_id") == object_snapshot_id, "database and object restore used different snapshot IDs")
    regression_snapshot_id = validate_restore_regressions(
        require_document(documents, "restore-regressions.json")
    )
    restored_snapshot_id = validate_restored_joint_smoke(
        require_document(documents, "restored-joint-smoke.json")
    )
    require(regression_snapshot_id == object_snapshot_id, "restored attacks and object recovery used different snapshots")
    require(restored_snapshot_id == object_snapshot_id, "restored service and object recovery used different snapshot IDs")
    require(backup.get("snapshot_id") == restored_snapshot_id, "restored service and database backup used different snapshot IDs")


def validate_standalone_attacks(document: Mapping[str, Any], filename: str, phase: str) -> None:
    require_schema(document, filename)
    require(document.get("phase") == phase, f"{filename} phase must be {phase}")
    validate_attack_matrix(document, STANDALONE_ATTACK_CASES, filename)


def validate_pg12(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_standalone(require_document(documents, "standalone.json"))
    validate_standalone_attacks(
        require_document(documents, "standalone-attacks-clean-start.json"),
        "standalone-attacks-clean-start.json",
        "clean_start",
    )


def validate_pg13(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_standalone(require_document(documents, "standalone.json"))
    validate_standalone_attacks(
        require_document(documents, "standalone-attacks-restart.json"),
        "standalone-attacks-restart.json",
        "restart",
    )


def validate_pg14(documents: Mapping[str, dict[str, Any]]) -> None:
    validate_restore_regressions(require_document(documents, "restore-regressions.json"))
    validate_standalone_attacks(
        require_document(documents, "standalone-attacks-clean-start.json"),
        "standalone-attacks-clean-start.json",
        "clean_start",
    )
    validate_standalone_attacks(
        require_document(documents, "standalone-attacks-restart.json"),
        "standalone-attacks-restart.json",
        "restart",
    )


def validate_restored_schema(documents: Mapping[str, dict[str, Any]]) -> None:
    restored = require_document(documents, "schema-restored.json")
    validate_schema_document(restored, "schema-restored.json")
    first = require_document(documents, "schema-first.json")
    validate_schema_document(first, "schema-first.json")
    signature_fields = (
        "migration_count",
        "migration_names",
        "migration_batches",
        "required_table_checks",
        "required_column_checks",
        "unique_index_checks",
        "foreign_key_checks",
        "checked_tables",
        "checked_columns",
        "checked_unique_indexes",
        "checked_foreign_keys",
    )
    require(
        all(restored.get(field) == first.get(field) for field in signature_fields),
        "restored schema signature differs from the fresh schema",
    )


GateValidator = Callable[[Mapping[str, dict[str, Any]]], None]
GATE_DEFINITIONS: dict[str, tuple[tuple[str, ...], GateValidator]] = {
    "PG-01": (("schema-first.json", "schema-repeat.json", "migration-fresh.json", "migration-repeat.json", "migration-seed.json"), validate_pg01),
    "PG-02": (("migration-seed.json",), validate_pg02),
    "PG-03": (("regressions.json", "transaction-concurrency.json"), validate_pg03),
    "PG-04": (("backup-restore.json", "restored-joint-smoke.json"), validate_pg04),
    "PG-05": (("backup-restore.json", "restore-regressions.json", "restored-joint-smoke.json"), validate_pg05),
    "PG-06": (("media-setup.json", "media-audit.json"), validate_pg06),
    "PG-07": (("media-audit.json", "media-lifecycle.json"), validate_pg07),
    "PG-08": (("media-lifecycle.json",), validate_pg08),
    "PG-09": (("media-outage.json", "media-recover.json"), validate_pg09),
    "PG-10": (("media-audit.json", "media-migrate-prefix.json"), validate_pg10),
    "PG-11": (("backup-restore.json", "media-backup-manifest.json", "media-purge.json", "media-restore.json", "media-migrate-prefix.json", "restore-regressions.json", "restored-joint-smoke.json"), validate_pg11),
    "PG-12": (("standalone.json", "standalone-attacks-clean-start.json"), validate_pg12),
    "PG-13": (("standalone.json", "standalone-attacks-restart.json"), validate_pg13),
    "PG-14": (("restore-regressions.json", "standalone-attacks-clean-start.json", "standalone-attacks-restart.json"), validate_pg14),
}


def gate_rows(documents: Mapping[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for gate, (evidence, validator) in GATE_DEFINITIONS.items():
        missing = [name for name in evidence if name not in documents]
        if missing:
            status = "not_run"
            error = f"missing evidence: {', '.join(missing)}"
        else:
            try:
                validator(documents)
            except (EvidenceError, KeyError, TypeError) as exc:
                status = "fail"
                error = str(exc)
            else:
                status = "pass"
                error = None
        row: dict[str, Any] = {"id": gate, "status": status, "evidence": list(evidence)}
        if error:
            row["diagnostic"] = error
            errors.append(f"{gate}: {error}")
        rows.append(row)
    return rows, errors


def inspect_source(source: Path) -> dict[str, dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    total_size = 0
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"symbolic links are forbidden in evidence: {path.name}")
        if not path.is_file():
            continue
        if path.parent != source:
            raise ValueError(f"nested evidence files are forbidden: {path.relative_to(source)}")
        if path.name in RESERVED_OUTPUT_FILES:
            raise ValueError(f"reserved assembler output found in source: {path.name}")
        if path.name not in set(REQUIRED_FILES) | OPTIONAL_SOURCE_FILES:
            raise ValueError(f"unexpected evidence file is not allowlisted: {path.name}")
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            raise ValueError(f"forbidden artifact file type: {path.name}")
        if path.suffix.lower() != ".json":
            raise ValueError(f"only JSON evidence may be assembled: {path.name}")
        size = path.stat().st_size
        require(size <= MAX_JSON_BYTES, f"evidence JSON is too large: {path.name}")
        total_size += size
        require(total_size <= MAX_TOTAL_JSON_BYTES, "total evidence JSON size exceeds the limit")
        document = load_json(path)
        assert_sanitized(document, source=path.name)
        documents[path.name] = document
    return documents


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    destination = args.destination.resolve()
    require(not source.exists() or source.is_dir(), f"source is not a directory: {source}")
    require(source != destination, "source and destination must differ")
    require(not source.is_relative_to(destination), "destination must not contain source")
    require(not destination.is_relative_to(source), "destination must not be inside source")

    documents = inspect_source(source) if source.is_dir() else {}
    rows, gate_errors = gate_rows(documents)

    common_errors: list[str] = []
    if not source.is_dir():
        common_errors.append("source evidence directory was not created")
    missing = [name for name in REQUIRED_FILES if name not in documents]
    if missing:
        common_errors.append(f"missing required result files: {', '.join(missing)}")
    try:
        validate_run_and_cleanup(documents)
    except (EvidenceError, KeyError, TypeError) as exc:
        common_errors.append(str(exc))
    for name, validator in (
        ("environment.json", validate_environment),
        ("infrastructure.json", validate_infrastructure),
    ):
        if name not in documents:
            continue
        try:
            validator(documents[name])
        except (EvidenceError, KeyError, TypeError) as exc:
            common_errors.append(str(exc))
    if "schema-restored.json" in documents and "schema-first.json" in documents:
        try:
            validate_restored_schema(documents)
        except (EvidenceError, KeyError, TypeError) as exc:
            common_errors.append(str(exc))
    if "failure-summary.json" in documents:
        failure = documents["failure-summary.json"]
        try:
            require_schema(failure, "failure-summary.json")
            require(failure.get("status") == "fail", "failure-summary.json.status must be fail")
            nonempty_string(failure.get("stage"), "failure-summary.json.stage")
            integer(failure.get("exit_code"), "failure-summary.json.exit_code", minimum=1)
            logs = sequence(failure.get("logs"), "failure-summary.json.logs")
            for index, raw_log in enumerate(logs):
                log = mapping(raw_log, f"failure-summary.json.logs[{index}]")
                nonempty_string(log.get("file"), f"failure-summary.json.logs[{index}].file")
                integer(log.get("size_bytes"), f"failure-summary.json.logs[{index}].size_bytes")
        except (EvidenceError, KeyError, TypeError) as exc:
            common_errors.append(str(exc))
        common_errors.append("failure-summary.json records a failed run")

    statuses = [row["status"] for row in rows]
    fully_green = not common_errors and not gate_errors and statuses == ["pass"] * 14
    overall_status = "pass" if fully_green else "fail"

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name, document in sorted(documents.items()):
        write_json(destination / name, document)

    summary = {
        "pass": statuses.count("pass"),
        "fail": statuses.count("fail"),
        "not_run": statuses.count("not_run"),
        "environment_blocked": 0,
        "hard_failures": sum(
            row["id"] in HARD_GATES and row["status"] == "fail" for row in rows
        ),
    }
    production_gates = {
        "schema_version": 1,
        "workflow": "Payload production gates",
        "source_commit": os.environ.get("GITHUB_SHA", "unknown"),
        "run_id": os.environ.get("GITHUB_RUN_ID", "unknown"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT", "unknown"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": overall_status,
        "gates": rows,
        "summary": summary,
        "validation_errors": common_errors + gate_errors,
        "hpoi_requests": (
            documents.get("regressions.json", {}).get("hpoi_requests")
            if isinstance(documents.get("regressions.json", {}).get("hpoi_requests"), int)
            else "not_run"
        ),
        "cleanup": documents.get("cleanup.json", {}).get("status", "not_run"),
        "artifact_retention_days": 5,
    }
    assert_sanitized(production_gates, source="production-gates.json")
    write_json(destination / "production-gates.json", production_gates)

    manifest_files: list[dict[str, Any]] = []
    for path in sorted(destination.glob("*.json")):
        payload = path.read_bytes()
        manifest_files.append(
            {"name": path.name, "sha256": hashlib.sha256(payload).hexdigest(), "size_bytes": len(payload)}
        )
    manifest = {
        "schema_version": 1,
        "source_commit": os.environ.get("GITHUB_SHA", "unknown"),
        "overall_status": overall_status,
        "files": manifest_files,
        "database_backups": 0,
        "image_objects": 0,
        "runtime_secrets": 0,
    }
    write_json(destination / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "files": len(manifest_files) + 1,
                "status": "sanitized",
                "overall_status": overall_status,
            },
            sort_keys=True,
        )
    )
    # Diagnostic assembly intentionally succeeds so the workflow can upload the
    # failure evidence.  A later workflow step must enforce overall_status.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
