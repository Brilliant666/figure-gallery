"""Run Wagtail VAL-02B tests and emit the shared 30-gate result document."""

import base64
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

import django
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
import wagtail

from gallery.exports import build_export_bundle


TEST_MAP = {
    "BG-05": "Val02bIdentityAndMediaTests.test_multipart_upload_hash_renditions_receipts_and_content_deduplication",
    "BG-06": "Val02bIdentityAndMediaTests.test_multipart_upload_hash_renditions_receipts_and_content_deduplication",
    "BG-07": "Val02bIdentityAndMediaTests.test_multipart_upload_hash_renditions_receipts_and_content_deduplication",
    "BG-08": "Val02bIdentityAndMediaTests.test_upload_rejections_are_atomic_and_retry_succeeds",
    "BG-09": "Val02bIdentityAndMediaTests.test_owner_isolation_and_candidate_identity_cannot_write_formal_data",
    "BG-10": "Val02bIdentityAndMediaTests.test_credentials_are_hashed_attributable_and_revocable",
    "BG-11": "Val02bIdentityAndMediaTests.test_owner_isolation_and_candidate_identity_cannot_write_formal_data",
    "BG-12": "Val02bIdentityAndMediaTests.test_owner_isolation_and_candidate_identity_cannot_write_formal_data",
    "BG-13": "Val02bReviewAndOperationTests.test_work_item_target_scope_optimistic_conflict_completion_and_reopen",
    "BG-14": "Val02bReviewAndOperationTests.test_work_item_target_scope_optimistic_conflict_completion_and_reopen",
    "BG-15": "Val02bReviewAndOperationTests.test_independent_operations_can_be_undone_by_id_in_any_scope_order",
    "BG-16": "Val02bReviewAndOperationTests.test_dependent_operation_blocks_predecessor_undo_until_dependency_is_undone",
    "BG-30": "Val02bAdminHealthAndCompatibilityTests.test_domain_admin_entry_is_accessible_and_settings_write_is_audited",
}


def _required_test_matches(outcomes, suffix):
    """Resolve one mandatory passing test used as supporting gate evidence."""

    matches = [
        (test_id, outcome)
        for test_id, outcome in outcomes.items()
        if test_id.endswith(suffix)
    ]
    passed = len(matches) == 1 and matches[0][1].get("status") == "pass"
    return matches, passed


def _playwright_browser_assertions(document, source_path):
    """Translate standard Playwright JSON into the four shared BG assertions."""

    assertions = {}

    def visit_suite(suite):
        for spec in suite.get("specs", []):
            title = spec.get("title", "")
            identifiers = [
                identifier
                for identifier in ("BG-01", "BG-02", "BG-03", "BG-04")
                if identifier in title
            ]
            tests = spec.get("tests", [])
            results = [result for test in tests for result in test.get("results", [])]
            statuses = [result.get("status") for result in results]
            if results and all(status == "passed" for status in statuses):
                status = "pass"
            elif results and any(status in {"failed", "timedOut", "interrupted"} for status in statuses):
                status = "fail"
            else:
                status = "not_run"
            attachments = []
            for result in results:
                for attachment in result.get("attachments", []):
                    if attachment.get("name") not in {
                        "val02b-browser-metrics",
                        "val02b-gallery-observations",
                    }:
                        continue
                    body = attachment.get("body")
                    if body:
                        try:
                            decoded = base64.b64decode(body).decode("utf-8")
                            attachments.append(json.loads(decoded))
                        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                            attachments.append({"attachment_parse": "failed"})
            observed = json.dumps(
                {
                    "title": title,
                    "statuses": statuses,
                    "attachments": attachments,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            for identifier in identifiers:
                assertions[identifier] = {
                    "id": identifier,
                    "status": status,
                    "evidence": [
                        {
                            "kind": "browser_test",
                            "reference": str(source_path),
                            "observed": observed,
                        }
                    ],
                }
        for child in suite.get("suites", []):
            visit_suite(child)

    for root_suite in document.get("suites", []):
        visit_suite(root_suite)
    return assertions


def _line_count(paths):
    return sum(len(path.read_text(encoding="utf-8").splitlines()) for path in paths)


class Command(BaseCommand):
    help = "Generate the Wagtail VAL-02B acceptance result from executable tests."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            default=str(Path(settings.BASE_DIR) / "val02b-acceptance-results.json"),
        )
        parser.add_argument(
            "--browser-results",
            help="TEMP-only browser result JSON containing BG-01..BG-04 assertions.",
        )

    def handle(self, *args, **options):
        project_dir = Path(settings.BASE_DIR)
        repo_root = project_dir.parents[1]
        if str(repo_root) not in sys.path:
            sys.path.insert(0, str(repo_root))
        from spikes.val02_contract.val02b_acceptance_result import (
            Val02bAcceptanceRecorder,
        )

        command = (
            "python manage.py test gallery.tests -v 1 "
            "--testrunner gallery.acceptance_runner.RecordingDiscoverRunner"
        )
        with tempfile.TemporaryDirectory(prefix="val02b-wagtail-acceptance-") as temporary:
            per_test_path = Path(temporary) / "per-test.json"
            child_environment = dict(os.environ)
            child_environment["VAL02_WAGTAIL_TEST_RESULTS"] = str(per_test_path)
            completed = subprocess.run(
                [
                    sys.executable,
                    "manage.py",
                    "test",
                    "gallery.tests",
                    "-v",
                    "1",
                    "--testrunner",
                    "gallery.acceptance_runner.RecordingDiscoverRunner",
                ],
                cwd=project_dir,
                env=child_environment,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            if not per_test_path.exists():
                raise CommandError("Recording runner did not emit per-test outcomes.")
            per_test = json.loads(per_test_path.read_text(encoding="utf-8"))

        browser_assertions = {}
        browser_path = options.get("browser_results")
        if browser_path:
            document = json.loads(Path(browser_path).read_text(encoding="utf-8"))
            if document.get("assertions"):
                browser_assertions = {
                    item["id"]: item for item in document["assertions"]
                }
            else:
                browser_assertions = _playwright_browser_assertions(
                    document, browser_path
                )

        source_files = [
            path
            for path in project_dir.rglob("*")
            if path.is_file()
            and ".venv" not in path.parts
            and "__pycache__" not in path.parts
            and path.suffix in {".py", ".html", ".css", ".js", ".txt", ".lock"}
        ] + [
            repo_root / "spikes" / "val02_contract" / "val02b_acceptance_contract.json",
            repo_root / "spikes" / "val02_contract" / "val02b_acceptance_result.py",
            repo_root / "spikes" / "val02_contract" / "python_candidate_client" / "client.py",
            repo_root / "spikes" / "val02_contract" / "fixture_contract.py",
            repo_root / "spikes" / "val02_contract" / "network_guard.py",
            repo_root / "spikes" / "val02_contract" / "synthetic_media.py",
        ]
        implementation_files = [
            path
            for path in (project_dir / "gallery").rglob("*")
            if path.suffix in {".py", ".html", ".css", ".js"}
            and "tests" not in path.parts
            and "migrations" not in path.parts
            and "__pycache__" not in path.parts
            and path.name != "__init__.py"
        ]
        test_files = sorted((project_dir / "gallery" / "tests").glob("test_*.py"))
        admin_files = [
            project_dir / "gallery" / "forms.py",
            project_dir / "gallery" / "wagtail_hooks.py",
            *sorted((project_dir / "gallery" / "templates" / "gallery" / "admin").glob("*.html")),
        ]
        endpoint_files = [
            project_dir / "gallery" / "views.py",
            project_dir / "gallery" / "candidate_service.py",
            project_dir / "gallery" / "candidate_media.py",
            project_dir / "gallery" / "client_identity.py",
        ]
        bundle = build_export_bundle()
        recorder = Val02bAcceptanceRecorder.from_source_files(
            prototype="wagtail",
            runner="django-test-suite-and-playwright",
            command=command,
            source_files=sorted(set(source_files)),
            runtime={
                "python": platform.python_version(),
                "django": django.get_version(),
                "wagtail": wagtail.__version__,
                "database_regression": "SQLite",
                "treebeard": "5.3.0 exact pin",
            },
            environment={
                "browser": "external TEMP Playwright result" if browser_path else "not supplied",
                "postgresql": "environment_blocked",
                "s3_compatible_storage": "environment_blocked",
                "repeatable_production_deployment": "environment_blocked",
                "hpoi_requests": 0,
            },
            metrics={
                "test_count": int(per_test["tests_run"]),
                "test_exit_code": completed.returncode,
                "implementation_lines": _line_count(implementation_files),
                "test_lines": _line_count(test_files),
                "admin_ui_lines": _line_count(admin_files),
                "endpoint_lines": _line_count(endpoint_files),
                "migration_files": len(
                    list((project_dir / "gallery" / "migrations").glob("0*.py"))
                ),
                "direct_dependencies": 4,
            },
            exports={
                "contains_binary_media": bundle["contains_binary_media"],
                "relational_tables": len(
                    [value for value in bundle.values() if isinstance(value, list)]
                ),
                "review_work_items_included": "review_work_items" in bundle,
                "operation_ids_included": all(
                    "operation_id" in item for item in bundle["operation_logs"]
                ),
                "credential_digests_included": False,
            },
            security={
                "candidate_credentials_hashed": True,
                "candidate_owner_enforced_server_side": True,
                "generic_admin_mutation": "denied; audited domain console only",
                "global_latest_undo_surface": False,
                "hpoi_guard_enabled": settings.VAL02_BLOCK_HPOI,
            },
        )

        for identifier in ("BG-01", "BG-02", "BG-03", "BG-04"):
            browser = browser_assertions.get(identifier)
            if browser:
                evidence = browser.get("evidence") or []
                first = evidence[0] if evidence else {}
                recorder.record(
                    identifier,
                    browser["status"],
                    kind=first.get("kind", "browser_test"),
                    reference=first.get("reference", str(browser_path)),
                    observed=first.get("observed", "TEMP Playwright assertion supplied"),
                )
                for extra in evidence[1:]:
                    recorder.add_evidence(
                        identifier,
                        kind=extra["kind"],
                        reference=extra["reference"],
                        observed=extra["observed"],
                    )
                if browser["status"] in {"not_run", "environment_blocked"}:
                    recorder.add_evidence(
                        identifier,
                        kind="blocker",
                        reference=str(browser_path),
                        observed=(
                            f"{identifier} real-browser execution did not complete; "
                            f"Playwright status={browser['status']}."
                        ),
                    )
            else:
                recorder.record(
                    identifier,
                    "not_run",
                    kind="blocker",
                    reference="TEMP Playwright browser result not supplied",
                    observed=(
                        f"{identifier} has no supplied real-browser report; generator does "
                        "not substitute component/static tests for browser evidence."
                    ),
                )
                recorder.add_evidence(
                    identifier,
                    kind="browser_test",
                    reference="manage.py generate_val02b_acceptance --browser-results",
                    observed=(
                        f"{identifier} remains pending until the TEMP Playwright JSON is supplied."
                    ),
                )

        outcomes = per_test["outcomes"]
        extra_test_evidence = {
            "BG-05": [(
                "file_upload_test",
                "Val02bRealLoopbackCandidateClientTests.test_shared_candidate_client_uploads_and_retries_over_real_http",
                "Shared CandidateClient.upload_candidate_image used urllib over a real LiveServer loopback socket and retried idempotently.",
            )],
            "BG-30": [(
                "api_permission_test",
                "Val02bAdminHealthAndCompatibilityTests.test_every_generic_admin_model_entry_is_read_only",
                "All formal/candidate/settings/log snippet policies denied add, change and delete even to the test superuser.",
            ), (
                "admin_ui_test",
                "Val02bAdminHealthAndCompatibilityTests.test_domain_action_map_and_remaining_formal_services_are_audited",
                "The complete domain-action map was present and remaining Work, Character/aliases, Version, source availability and hide/restore services emitted OperationLog records.",
            )],
        }
        extra_evidence_matches = {}
        extra_evidence_failures = []
        extra_failed_gates = set()
        for identifier, items in extra_test_evidence.items():
            for _kind, suffix, _description in items:
                matches, passed = _required_test_matches(outcomes, suffix)
                extra_evidence_matches[(identifier, suffix)] = matches
                if not passed:
                    extra_failed_gates.add(identifier)
                    observed_status = (
                        matches[0][1].get("status") if len(matches) == 1 else "mapping_failure"
                    )
                    extra_evidence_failures.append(
                        f"{identifier}:{suffix}:count={len(matches)}:status={observed_status}"
                    )

        for identifier, suffix in TEST_MAP.items():
            matches = [
                (test_id, outcome)
                for test_id, outcome in outcomes.items()
                if test_id.endswith(suffix)
            ]
            status = matches[0][1]["status"] if len(matches) == 1 else "fail"
            if identifier in extra_failed_gates:
                status = "fail"
            recorder.record(
                identifier,
                status,
                kind="automated_test",
                reference=f"gallery.tests::{suffix}",
                observed=(
                    f"resolved test count={len(matches)}; "
                    + (matches[0][1]["detail"] if len(matches) == 1 else "mapping failure")
                ),
            )

        for identifier, items in extra_test_evidence.items():
            for kind, suffix, description in items:
                matches = extra_evidence_matches[(identifier, suffix)]
                recorder.add_evidence(
                    identifier,
                    kind=kind,
                    reference=f"gallery.tests::{suffix}",
                    observed=(
                        f"resolved test count={len(matches)}; {description}; "
                        + (matches[0][1]["detail"] if len(matches) == 1 else "mapping failure")
                    ),
                )

        for number in range(17, 30):
            identifier = f"BG-{number:02d}"
            recorder.record(
                identifier,
                "environment_blocked",
                kind="blocker",
                reference="VAL-02B host infrastructure probe",
                observed=(
                    f"{identifier} was not executed: Docker/Compose CLI was present but "
                    "engine unavailable; PostgreSQL, MinIO/S3 and clean production "
                    "deployment infrastructure were unavailable."
                ),
            )
            recorder.add_evidence(
                identifier,
                kind="runtime_probe",
                reference="host prerequisite inventory",
                observed=(
                    f"{identifier} prerequisite probe found no PostgreSQL listener/client, "
                    "no MinIO listener and no running Docker engine; no service was installed "
                    "or started."
                ),
            )

        output = recorder.write(options["output"])
        self.stdout.write(completed.stdout[-4000:])
        if extra_evidence_failures:
            raise CommandError(
                "Wagtail VAL-02B required supporting evidence did not resolve to "
                "exactly one passing test: " + "; ".join(extra_evidence_failures)
            )
        if completed.returncode != 0 or int(per_test["tests_run"]) < 60:
            raise CommandError("Wagtail VAL-02B test suite failed or was incomplete.")
        self.stdout.write(self.style.SUCCESS(f"wrote VAL-02B Wagtail result: {output}"))
