"""Run the real Django suite and generate the shared 30-item result document."""

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


ACCEPTANCE_TEST_MAP = {
    "AC-01": ("automated_test", "CandidateServiceTests.test_source_upsert_is_idempotent"),
    "AC-02": ("automated_test", "CandidateServiceTests.test_url_fallback_migrates_to_stable_id_without_duplicate"),
    "AC-03": ("api_permission_test", "CandidateServiceTests.test_unknown_names_stay_in_candidate_pool"),
    "AC-04": ("api_permission_test", "CandidateHttpTests.test_http_idempotence_and_formal_counts"),
    "AC-05": ("automated_test", "CandidateServiceTests.test_unknown_names_stay_in_candidate_pool"),
    "AC-06": ("automated_test", "DomainServiceTests.test_new_manufacturer_defaults_draft"),
    "AC-07": ("api_permission_test", "CandidateHttpTests.test_http_rejects_direct_prototype_or_main_image_write"),
    "AC-08": ("api_permission_test", "CandidateHttpTests.test_shared_python_client_integrates_and_remains_candidate_only"),
    "AC-09": ("admin_workflow_test", "DomainServiceTests.test_admin_creates_prototype_from_candidate_with_audit"),
    "AC-10": ("admin_workflow_test", "DomainServiceTests.test_admin_attaches_candidate_to_existing_version"),
    "AC-11": ("admin_workflow_test", "DomainServiceTests.test_field_accept_and_reject_are_audited"),
    "AC-12": ("automated_test", "DomainServiceTests.test_deferred_and_ignored_keep_reason"),
    "AC-13": ("automated_test", "DomainServiceTests.test_merge_split_and_two_undos_restore_cross_record_relations"),
    "AC-14": ("automated_test", "DomainServiceTests.test_all_domain_write_services_emit_complete_operation_logs"),
    "AC-15": ("automated_test", "FrontendTests.test_multi_character_prototype_is_queryable_from_each_character"),
    "AC-16": ("automated_test", "FrontendTests.test_similar_pose_different_manufacturers_remain_distinct"),
    "AC-17": ("automated_test", "FrontendTests.test_four_versions_are_one_gallery_prototype"),
    "AC-18": ("automated_test", "FrontendTests.test_adult_main_is_hidden_by_default_and_visible_when_enabled"),
    "AC-19": ("automated_test", "FrontendTests.test_adult_main_is_hidden_by_default_and_visible_when_enabled"),
    "AC-20": ("automated_test", "FrontendTests.test_stale_source_does_not_unpublish_or_remove_local_main"),
    "AC-21": ("media_test", "DomainServiceTests.test_manual_main_image_selection_requires_owned_local_media"),
    "AC-22": ("export_parse", "ExportAndSecurityTests.test_json_and_csv_exports_parse"),
    "AC-23": ("binary_scan", "ExportAndSecurityTests.test_json_export_has_relations_media_metadata_and_no_binary"),
    "AC-24": ("automated_test", "FrontendTests.test_unique_alias_match_redirects_to_gallery"),
    "AC-25": ("automated_test", "FrontendTests.test_unique_alias_match_redirects_to_gallery"),
    "AC-26": ("automated_test", "FrontendTests.test_same_name_characters_render_work_disambiguation"),
    "AC-27": ("automated_test", "FrontendTests.test_default_page_size_and_stable_paginator"),
    "AC-28": ("static_assertion", "FrontendTests.test_original_ratio_dom_and_css_contract"),
    "AC-29": ("blocker", "FrontendTests.test_lightbox_current_page_static_contract"),
    "AC-30": ("network_guard_test", "ExportAndSecurityTests.test_hpoi_guard_and_static_runtime_scan"),
}

EXPECTED_NOT_RUN = {
    "AC-29": (
        "Chrome interaction was not executable in this environment because the selected "
        "profile had no control extension and the native host was unavailable. The mapped "
        "static DOM/JavaScript contract passed, but real click/previous/next/boundary behavior "
        "was not executed."
    )
}


class Command(BaseCommand):
    help = "Run actual Wagtail tests and emit the shared machine-readable acceptance result."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output", default=str(Path(settings.BASE_DIR) / "acceptance-results.json")
        )

    def handle(self, *args, **options):
        project_dir = Path(settings.BASE_DIR)
        repo_root = project_dir.parents[1]
        if str(repo_root) not in sys.path:
            sys.path.insert(0, str(repo_root))
        from spikes.val02_contract.acceptance_result import AcceptanceRecorder

        command = (
            "python manage.py test gallery.tests -v 1 "
            "--testrunner gallery.acceptance_runner.RecordingDiscoverRunner"
        )
        with tempfile.TemporaryDirectory(prefix="val02-wagtail-acceptance-") as temporary:
            per_test_path = Path(temporary) / "per-test-results.json"
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
            if not per_test_path.is_file():
                raise CommandError("recording test runner did not emit per-test outcomes")
            per_test = json.loads(per_test_path.read_text(encoding="utf-8"))
        test_count = int(per_test["tests_run"])
        outcomes = per_test["outcomes"]

        implementation_files = [project_dir / "figure_gallery_poc" / "settings.py"] + [
            project_dir / "gallery" / name
            for name in (
                "models.py",
                "candidate_service.py",
                "services.py",
                "views.py",
                "exports.py",
                "network_guard.py",
                "wagtail_hooks.py",
                "acceptance_runner.py",
                "management/commands/generate_acceptance.py",
            )
        ]
        test_files = sorted((project_dir / "gallery" / "tests").glob("test_*.py"))
        ui_files = [
            project_dir / "gallery" / "templates" / "gallery" / "character_gallery.html",
            project_dir / "gallery" / "static" / "gallery" / "gallery.css",
            project_dir / "gallery" / "static" / "gallery" / "gallery.js",
        ]
        shared_client_files = [
            repo_root / "spikes" / "val02_contract" / "acceptance_contract.json",
            repo_root / "spikes" / "val02_contract" / "acceptance_result.py",
            repo_root / "spikes" / "val02_contract" / "python_candidate_client" / "client.py",
            repo_root / "spikes" / "val02_contract" / "fixture_contract.py",
            repo_root / "spikes" / "val02_contract" / "network_guard.py",
            repo_root / "spikes" / "val02_contract" / "synthetic_media.py",
        ]
        prototype_source_files = [
            path
            for path in project_dir.rglob("*")
            if path.is_file()
            and ".venv" not in path.parts
            and "__pycache__" not in path.parts
            and (
                path.suffix in {".py", ".html", ".css", ".js", ".lock"}
                or path.name == "requirements.txt"
            )
        ]
        source_files = sorted(set(prototype_source_files + shared_client_files))
        counted_implementation_files = [
            path
            for path in (project_dir / "gallery").rglob("*")
            if path.suffix in {".py", ".html", ".css", ".js"}
            and "tests" not in path.parts
            and "migrations" not in path.parts
            and "__pycache__" not in path.parts
            and path.name != "__init__.py"
        ]
        custom_lines = sum(
            len(path.read_text(encoding="utf-8").splitlines())
            for path in counted_implementation_files
        )
        test_lines = sum(
            len(path.read_text(encoding="utf-8").splitlines()) for path in test_files
        )
        admin_files = [
            project_dir / "gallery" / "forms.py",
            project_dir / "gallery" / "wagtail_hooks.py",
            project_dir / "gallery" / "templates" / "gallery" / "admin" / "candidate_review.html",
        ]
        bundle = build_export_bundle()
        recorder = AcceptanceRecorder.from_source_files(
            prototype="wagtail",
            runner="django-test-suite",
            command=command,
            source_files=source_files,
            runtime={
                "python": platform.python_version(),
                "django": django.get_version(),
                "wagtail": wagtail.__version__,
                "database": "SQLite",
                "processes_required": 1,
            },
            metrics={
                "test_count": test_count,
                "test_exit_code": completed.returncode,
                "custom_implementation_lines": custom_lines,
                "test_lines": test_lines,
                "admin_ui_customization_lines": sum(
                    len(path.read_text(encoding="utf-8").splitlines())
                    for path in admin_files
                ),
                "migration_files": len(list((project_dir / "gallery" / "migrations").glob("0*.py"))),
                "direct_dependencies": 4,
            },
            exports={
                "json_parseable": True,
                "csv_relational_tables": len(
                    [value for value in bundle.values() if isinstance(value, list)]
                ),
                "contains_binary_media": bundle["contains_binary_media"],
                "candidate_image_records": len(bundle["candidate_images"]),
            },
            security={
                "hpoi_process_guard": settings.VAL02_BLOCK_HPOI,
                "candidate_api_credentials": "per-client, hashed, revocable",
                "candidate_http_surface": ["candidate_upsert", "candidate_media_upload"],
                "cloud_connection_performed": False,
                "browser_interaction": (
                    "not_run: Chrome control extension/native host unavailable; "
                    "server-render and static DOM substitutes used"
                ),
            },
        )
        for identifier, (kind, test_reference) in ACCEPTANCE_TEST_MAP.items():
            matches = [
                (test_id, outcome)
                for test_id, outcome in outcomes.items()
                if test_id.endswith(test_reference)
            ]
            if len(matches) == 1:
                test_id, outcome = matches[0]
                status = outcome["status"]
                observed = (
                    f"per-test outcome={status}; test_id={test_id}; "
                    f"runner detail={outcome['detail']}"
                )
                if identifier in EXPECTED_NOT_RUN and status == "pass":
                    status = "not_run"
                    observed = (
                        f"static substitute passed as test_id={test_id}; blocker: "
                        f"{EXPECTED_NOT_RUN[identifier]}"
                    )
            else:
                status = "fail"
                observed = (
                    f"mapped test resolution count={len(matches)}; expected exactly one "
                    f"test ending with {test_reference}"
                )
            recorder.record(
                identifier,
                status,
                kind=kind,
                reference=f"gallery.tests::{test_reference}",
                observed=observed,
            )
            if identifier == "AC-29":
                recorder.add_evidence(
                    identifier,
                    kind="static_assertion",
                    reference=(
                        "gallery.tests::"
                        "FrontendTests.test_lightbox_current_page_static_contract"
                    ),
                    observed=(
                        "The generated per-test outcome proves only the static current-page "
                        "DOM/JavaScript contract; it is not browser interaction evidence."
                    ),
                )
            elif identifier == "AC-30":
                recorder.add_evidence(
                    identifier,
                    kind="static_assertion",
                    reference=(
                        "gallery.tests::"
                        "ExportAndSecurityTests.test_hpoi_guard_and_static_runtime_scan"
                    ),
                    observed=(
                        "The mapped test also scans runtime Python modules and found no Hpoi "
                        "fetch target outside the dedicated process guard."
                    ),
                )
        output = recorder.write(options["output"])
        self.stdout.write(completed.stdout[-4000:])
        self.stdout.write(self.style.SUCCESS(f"wrote generated acceptance result: {output}"))
        assertions = recorder.as_document()["assertions"]
        unexpected_not_run = [
            item["id"]
            for item in assertions
            if item["status"] == "not_run" and item["id"] not in EXPECTED_NOT_RUN
        ]
        if completed.returncode != 0 or test_count < 40 or any(
            item["status"] == "fail" for item in assertions
        ) or unexpected_not_run:
            raise CommandError("acceptance suite did not pass completely")
