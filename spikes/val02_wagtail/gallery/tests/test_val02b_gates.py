import hashlib
import json
import os
from io import BytesIO, StringIO
from pathlib import Path
import sys
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import checks
from django.core.exceptions import ImproperlyConfigured, PermissionDenied, ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import LiveServerTestCase, SimpleTestCase
from django.urls import reverse
from PIL import Image as PILImage
from wagtail.images import get_image_model
from wagtail.models import Collection, Page

from gallery.candidate_media import average_hash, import_candidate_image
from gallery.candidate_service import CandidateIngressError, upsert_candidate
from gallery.client_identity import (
    authenticate_candidate_client,
    create_candidate_client,
    disable_candidate_client,
    hash_candidate_token,
)
from gallery.forms import DomainOperationForm
from gallery.management.commands.generate_val02b_acceptance import (
    _required_test_matches,
)
from gallery.models import (
    CandidateClientCredential,
    CandidateImage,
    CandidateRecord,
    CandidateUploadReceipt,
    Character,
    FigurePrototype,
    FigureVersion,
    Manufacturer,
    OperationLog,
    ReviewWorkItem,
    SourceRecord,
    SystemSetting,
    Work,
)
from gallery.services import (
    complete_review_work_item,
    create_review_work_item,
    decide_review_work_item_field,
    maintain_character,
    maintain_figure_version,
    maintain_prototype_metadata,
    maintain_work,
    mark_source_unavailable,
    merge_prototypes,
    reopen_review_work_item,
    select_review_work_item_main_image,
    set_prototype_visibility,
    split_prototype,
    undo_operation,
)
from gallery.treebeard_compat import (
    VALIDATED_TREEBEARD_VERSION,
    enforce_validated_treebeard_version,
)

from .base import SeededTestCase

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from spikes.val02_contract.python_candidate_client.client import CandidateClient


TOKEN_A = "runtime-only-client-a-token-for-tests"
TOKEN_B = "runtime-only-client-b-token-for-tests"


def _png_bytes(color=(47, 113, 199, 255), size=(37, 53)):
    stream = BytesIO()
    PILImage.new("RGBA", size, color).save(stream, format="PNG", optimize=False)
    return stream.getvalue()


def _candidate_payload(suffix, *, title="Owned synthetic candidate"):
    return {
        "id": f"client-candidate-{suffix}",
        "source": {
            "source_type": "synthetic_val02b",
            "source_item_id": f"VAL02B-{suffix}",
            "source_url": f"https://synthetic.invalid/val02b/{suffix}",
        },
        "raw_title": title,
        "raw_character_names": ["Synthetic unknown"],
        "raw_work_name": "Synthetic work",
        "raw_manufacturer": "Synthetic maker",
        "raw_category": "scale",
        "raw_scale": "1/7",
        "raw_snapshot": {"synthetic": True},
        "images": [],
    }


class Val02bAcceptanceGeneratorGuardTests(SimpleTestCase):
    def test_required_supporting_evidence_must_resolve_to_one_passing_test(self):
        suffix = "GuardTests.test_required_evidence"
        cases = (
            ({}, 0, False),
            ({f"gallery.tests.{suffix}": {"status": "fail"}}, 1, False),
            (
                {
                    f"gallery.tests.one.{suffix}": {"status": "pass"},
                    f"gallery.tests.two.{suffix}": {"status": "pass"},
                },
                2,
                False,
            ),
            ({f"gallery.tests.{suffix}": {"status": "pass"}}, 1, True),
        )
        for outcomes, expected_count, expected_passed in cases:
            with self.subTest(outcomes=outcomes):
                matches, passed = _required_test_matches(outcomes, suffix)
                self.assertEqual(len(matches), expected_count)
                self.assertEqual(passed, expected_passed)


class Val02bIdentityAndMediaTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.reviewer = get_user_model().objects.get(username="fixture-admin")
        cls.owner_a, _ = create_candidate_client(
            client_id="val02b-client-a",
            token=TOKEN_A,
            reason="Create synthetic client A",
            actor=cls.reviewer,
        )
        cls.owner_b, _ = create_candidate_client(
            client_id="val02b-client-b",
            token=TOKEN_B,
            reason="Create synthetic client B",
            actor=cls.reviewer,
        )

    def _owned_candidate(self, suffix):
        result = upsert_candidate(
            _candidate_payload(suffix),
            owner=self.owner_a,
            actor_label="candidate-client:val02b-client-a",
        )
        return CandidateRecord.objects.get(pk=result["candidate_id"])

    def _metadata(self, candidate, binary, *, key, filename="synthetic.png"):
        with PILImage.open(BytesIO(binary)) as image:
            width, height = image.size
        return {
            "protocol_version": 2,
            "operation": "candidate_media_upload",
            "client_id": self.owner_a.client_id,
            "candidate_id": str(candidate.pk),
            "client_candidate_id": candidate.client_candidate_id,
            "idempotency_key": key,
            "filename": filename,
            "content_type": "image/png",
            "width": width,
            "height": height,
            "file_size": len(binary),
            "sha256": hashlib.sha256(binary).hexdigest(),
            "perceptual_hash": average_hash(binary),
        }

    def _post_media(self, metadata, binary, *, token=TOKEN_A, content_type="image/png"):
        upload = SimpleUploadedFile(
            metadata.get("filename", "synthetic.png"),
            binary,
            content_type=content_type,
        )
        return self.client.post(
            "/api/val02b/candidates/media/upload/",
            {"metadata": json.dumps(metadata), "file": upload},
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_X_CANDIDATE_CLIENT_ID=metadata.get("client_id", ""),
            REMOTE_ADDR="127.0.0.1",
        )

    def test_credentials_are_hashed_attributable_and_revocable(self):
        credential = CandidateClientCredential.objects.get(client_id="val02b-client-a")
        self.assertNotEqual(credential.token_hash, TOKEN_A)
        self.assertEqual(credential.token_hash, hash_candidate_token(TOKEN_A))
        self.assertEqual(
            authenticate_candidate_client(client_id=credential.client_id, token=TOKEN_A),
            credential,
        )
        disable_candidate_client(
            credential.client_id,
            reason="Revoke synthetic client A",
            actor=self.reviewer,
        )
        with self.assertRaises(PermissionDenied):
            authenticate_candidate_client(client_id=credential.client_id, token=TOKEN_A)
        self.assertTrue(
            OperationLog.objects.filter(
                operation=OperationLog.Operation.CLIENT_IDENTITY,
                related_records__action="candidate_client_disable",
            ).exists()
        )

    def test_owner_isolation_and_candidate_identity_cannot_write_formal_data(self):
        candidate = self._owned_candidate("OWNER-ISOLATION")
        prototype = FigurePrototype.objects.exclude(main_image=None).first()
        main_before = prototype.main_image_id
        formal_counts = (
            Work.objects.count(),
            Character.objects.count(),
            Manufacturer.objects.count(),
            FigurePrototype.objects.count(),
            FigureVersion.objects.count(),
        )
        attacked = _candidate_payload("OWNER-ISOLATION", title="Cross-owner overwrite")
        with self.assertRaises(CandidateIngressError):
            upsert_candidate(attacked, owner=self.owner_b)
        candidate.refresh_from_db()
        self.assertEqual(candidate.raw_title, "Owned synthetic candidate")
        for field in ("prototype", "figure_version", "main_image_id"):
            payload = _candidate_payload(f"FORMAL-{field}")
            payload[field] = prototype.pk
            with self.subTest(field=field), self.assertRaises(CandidateIngressError):
                upsert_candidate(payload, owner=self.owner_a)
        rejected = _candidate_payload("MAIN-REQUEST")
        rejected["requested_changes"] = {"main_image_id": 999999}
        result = upsert_candidate(rejected, owner=self.owner_a)
        prototype.refresh_from_db()
        self.assertIn("main_image_id", result["rejected_fields"])
        self.assertEqual(prototype.main_image_id, main_before)
        self.assertEqual(
            (
                Work.objects.count(),
                Character.objects.count(),
                Manufacturer.objects.count(),
                FigurePrototype.objects.count(),
                FigureVersion.objects.count(),
            ),
            formal_counts,
        )

    def test_http_attack_matrix_rejects_missing_wrong_revoked_and_cross_owner(self):
        endpoint = "/api/val02/candidates/upsert/"

        def post(payload, *, token="", client_id="val02b-client-a"):
            headers = {
                "HTTP_X_CANDIDATE_CLIENT_ID": client_id,
                "REMOTE_ADDR": "127.0.0.1",
            }
            if token:
                headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
            return self.client.post(
                endpoint,
                data=json.dumps(
                    {
                        "protocol_version": 1,
                        "operation": "candidate_upsert",
                        "candidate": payload,
                    }
                ),
                content_type="application/json",
                **headers,
            )

        self.assertEqual(post(_candidate_payload("NO-TOKEN")).status_code, 401)
        self.assertEqual(
            post(_candidate_payload("WRONG-TOKEN"), token="wrong").status_code,
            401,
        )
        first = post(_candidate_payload("HTTP-OWNED"), token=TOKEN_A)
        self.assertEqual(first.status_code, 201)
        cross = post(
            _candidate_payload("HTTP-OWNED", title="Cross client mutation"),
            token=TOKEN_B,
            client_id="val02b-client-b",
        )
        self.assertEqual(cross.status_code, 403)
        formal = _candidate_payload("HTTP-FORMAL")
        formal["figure_prototype"] = 1
        self.assertEqual(post(formal, token=TOKEN_A).status_code, 403)
        disable_candidate_client(
            self.owner_a.client_id,
            reason="Revoke before HTTP retry",
            actor=self.reviewer,
        )
        self.assertEqual(
            post(_candidate_payload("REVOKED"), token=TOKEN_A).status_code,
            401,
        )

    def test_multipart_upload_hash_renditions_receipts_and_content_deduplication(self):
        candidate = self._owned_candidate("MEDIA")
        binary = _png_bytes()
        first_metadata = self._metadata(
            candidate, binary, key="media-idempotency-key-0001"
        )
        first = self._post_media(first_metadata, binary)
        self.assertEqual(first.status_code, 201, first.content)
        first_result = first.json()
        record = CandidateImage.objects.get(pk=first_result["candidate_image_id"])
        self.assertEqual(record.sha256, hashlib.sha256(binary).hexdigest())
        self.assertEqual(record.perceptual_hash, average_hash(binary))
        self.assertTrue(record.image.file.storage.exists(record.storage_key))
        self.assertTrue(record.image.file.storage.exists(first_result["thumbnail_key"]))
        self.assertTrue(record.image.file.storage.exists(first_result["preview_key"]))

        exact_retry = self._post_media(first_metadata, binary)
        self.assertEqual(exact_retry.status_code, 200)
        self.assertEqual(exact_retry.json()["candidate_image_id"], record.pk)

        renamed_metadata = self._metadata(
            candidate,
            binary,
            key="media-idempotency-key-0002",
            filename="renamed-same-content.png",
        )
        renamed = self._post_media(renamed_metadata, binary)
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["candidate_image_id"], record.pk)
        self.assertEqual(candidate.images.filter(sha256=record.sha256).count(), 1)
        self.assertEqual(CandidateUploadReceipt.objects.filter(candidate=candidate).count(), 2)

        changed = _png_bytes(color=(201, 73, 41, 255))
        changed_metadata = self._metadata(
            candidate,
            changed,
            key="media-idempotency-key-0003",
            filename=first_metadata["filename"],
        )
        changed_result = self._post_media(changed_metadata, changed)
        self.assertEqual(changed_result.status_code, 201)
        self.assertNotEqual(changed_result.json()["sha256"], record.sha256)
        self.assertEqual(candidate.images.filter(image__isnull=False).count(), 2)

    def test_upload_rejections_are_atomic_and_retry_succeeds(self):
        candidate = self._owned_candidate("MEDIA-FAILURE")
        valid = _png_bytes()
        valid_metadata = self._metadata(
            candidate, valid, key="media-retry-idempotency-0001"
        )
        before = (
            CandidateImage.objects.count(),
            CandidateUploadReceipt.objects.count(),
            FigurePrototype.objects.count(),
        )

        text_metadata = dict(valid_metadata)
        text_metadata.update(
            {
                "idempotency_key": "media-invalid-text-key-0001",
                "filename": "invalid.txt",
                "content_type": "text/plain",
                "file_size": 14,
                "sha256": hashlib.sha256(b"synthetic text").hexdigest(),
            }
        )
        self.assertEqual(
            self._post_media(
                text_metadata, b"synthetic text", content_type="text/plain"
            ).status_code,
            400,
        )
        oversize = b"x" * (64 * 1024 + 1)
        oversize_metadata = dict(text_metadata)
        oversize_metadata.update(
            {
                "idempotency_key": "media-oversize-key-0001",
                "filename": "oversize.png",
                "content_type": "image/png",
                "file_size": len(oversize),
                "sha256": hashlib.sha256(oversize).hexdigest(),
            }
        )
        self.assertEqual(self._post_media(oversize_metadata, oversize).status_code, 400)
        mismatch_metadata = dict(valid_metadata)
        mismatch_metadata["idempotency_key"] = "media-mismatch-key-0001"
        self.assertEqual(
            self._post_media(
                mismatch_metadata, valid, content_type="text/plain"
            ).status_code,
            400,
        )
        self.assertEqual(
            (
                CandidateImage.objects.count(),
                CandidateUploadReceipt.objects.count(),
                FigurePrototype.objects.count(),
            ),
            before,
        )

        files_before = {
            item.relative_to(settings.MEDIA_ROOT).as_posix()
            for item in Path(settings.MEDIA_ROOT).rglob("*")
            if item.is_file()
        }
        upload = SimpleUploadedFile("retry.png", valid, content_type="image/png")
        with mock.patch(
            "gallery.candidate_media.OperationLog.objects.create",
            side_effect=RuntimeError("synthetic audit failure"),
        ):
            with self.assertRaises(RuntimeError):
                import_candidate_image(
                    owner=self.owner_a,
                    metadata=valid_metadata,
                    uploaded_file=upload,
                )
        files_after_failure = {
            item.relative_to(settings.MEDIA_ROOT).as_posix()
            for item in Path(settings.MEDIA_ROOT).rglob("*")
            if item.is_file()
        }
        self.assertEqual(files_after_failure, files_before)
        self.assertEqual(CandidateImage.objects.count(), before[0])
        self.assertEqual(CandidateUploadReceipt.objects.count(), before[1])
        retry = self._post_media(valid_metadata, valid)
        self.assertEqual(retry.status_code, 201)


class Val02bRealLoopbackCandidateClientTests(LiveServerTestCase):
    """Exercise the shared stdlib multipart client over a real loopback socket."""

    host = "127.0.0.1"

    def setUp(self):
        super().setUp()
        call_command("seed_synthetic", "--reset", verbosity=0)
        self.reviewer = get_user_model().objects.get(username="fixture-admin")
        self.owner, _ = create_candidate_client(
            client_id="val02b-real-loopback-client",
            token=TOKEN_A,
            reason="Create real-loopback shared-client identity",
            actor=self.reviewer,
        )
        result = upsert_candidate(
            _candidate_payload("REAL-LOOPBACK"),
            owner=self.owner,
            actor_label="candidate-client:val02b-real-loopback-client",
        )
        self.candidate = CandidateRecord.objects.get(pk=result["candidate_id"])
        fixture_path = (
            Path(__file__).resolve().parents[3]
            / "val02_contract"
            / "fixtures"
            / "domain_fixture.json"
        )
        self.fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    def test_shared_candidate_client_uploads_and_retries_over_real_http(self):
        image = next(
            item["images"][0]
            for item in self.fixture["candidate_records"]
            if item.get("images")
        )
        environment = {
            "VAL02_WAGTAIL_CANDIDATE_CLIENT_ID": self.owner.client_id,
            "VAL02_WAGTAIL_CANDIDATE_TOKEN": TOKEN_A,
            "VAL02_WAGTAIL_CANDIDATE_ENDPOINT": (
                f"{self.live_server_url}/api/val02/candidates/upsert/"
            ),
            "VAL02_WAGTAIL_CANDIDATE_UPLOAD_ENDPOINT": (
                f"{self.live_server_url}/api/val02b/candidates/media/upload/"
            ),
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            client = CandidateClient.from_environment("wagtail")
            first = client.upload_candidate_image(
                candidate_id=str(self.candidate.pk),
                client_candidate_id=self.candidate.client_candidate_id,
                image=image,
            )
            second = client.upload_candidate_image(
                candidate_id=str(self.candidate.pk),
                client_candidate_id=self.candidate.client_candidate_id,
                image=image,
                filename="same-content-renamed.png",
            )
        self.assertEqual(first["outcome"], "new")
        self.assertEqual(second["outcome"], "unchanged")
        self.assertEqual(first["candidate_image_id"], second["candidate_image_id"])
        self.assertEqual(
            CandidateImage.objects.filter(
                candidate=self.candidate, sha256=first["sha256"]
            ).count(),
            1,
        )


class Val02bReviewAndOperationTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        user_model = get_user_model()
        cls.admin_a = user_model.objects.get(username="fixture-admin")
        cls.admin_b = user_model.objects.create_user(
            username="fixture-admin-b",
            password="runtime-only-test-password",
            is_staff=True,
        )

    def _review_candidate(self):
        return CandidateRecord.objects.filter(target_prototype__isnull=False).first()

    def test_work_item_target_scope_optimistic_conflict_completion_and_reopen(self):
        candidate = self._review_candidate()
        allowed = candidate.target_prototype
        forbidden = FigurePrototype.objects.exclude(pk=allowed.pk).first()
        item = create_review_work_item(
            candidate.pk,
            allowed_target_ids=[allowed.pk],
            reason="Create bounded synthetic work item",
            actor=self.admin_a,
        )
        with self.assertRaises(PermissionDenied):
            decide_review_work_item_field(
                item.pk,
                expected_version=1,
                field_name="title",
                accept=True,
                target_prototype_id=forbidden.pk,
                reason="Forbidden target probe",
                actor=self.admin_a,
            )
        candidate.raw_title = "Accepted through bounded work item"
        candidate.save(update_fields=["raw_title", "updated_at"])
        decide_review_work_item_field(
            item.pk,
            expected_version=1,
            field_name="title",
            accept=True,
            target_prototype_id=allowed.pk,
            reason="Accept within allowed target",
            actor=self.admin_a,
        )
        with self.assertRaisesMessage(ValidationError, "conflict"):
            decide_review_work_item_field(
                item.pk,
                expected_version=1,
                field_name="scale",
                accept=False,
                reason="Second administrator stale submit",
                actor=self.admin_b,
            )
        item.refresh_from_db()
        completed = complete_review_work_item(
            item.pk,
            expected_version=item.lock_version,
            reason="Complete bounded review",
            actor=self.admin_b,
        )
        self.assertEqual(completed.status, ReviewWorkItem.Status.COMPLETED)
        with self.assertRaises(ValidationError):
            decide_review_work_item_field(
                item.pk,
                expected_version=completed.lock_version,
                field_name="scale",
                accept=False,
                reason="Completed work item cannot mutate",
                actor=self.admin_a,
            )
        reopened = reopen_review_work_item(
            item.pk,
            reason="Explicit audited reopen",
            actor=self.admin_a,
        )
        self.assertEqual(reopened.status, ReviewWorkItem.Status.OPEN)
        self.assertEqual(reopened.reopen_count, 1)
        self.assertTrue(
            OperationLog.objects.filter(
                operation=OperationLog.Operation.REVIEW_WORK,
                related_records__action="review_work_item_reopen",
            ).exists()
        )

    def test_work_item_main_image_must_come_from_candidate_and_allowed_target(self):
        candidate = self._review_candidate()
        target = candidate.target_prototype
        item = create_review_work_item(
            candidate.pk,
            allowed_target_ids=[target.pk],
            reason="Create image-selection work item",
            actor=self.admin_a,
        )
        image = candidate.images.filter(image__isnull=False).first()
        select_review_work_item_main_image(
            item.pk,
            expected_version=1,
            prototype_id=target.pk,
            candidate_image_id=image.pk,
            reason="Select reviewed synthetic main image",
            actor=self.admin_a,
        )
        target.refresh_from_db()
        self.assertEqual(target.main_image_id, image.image_id)
        foreign = CandidateImage.objects.exclude(candidate=candidate).filter(
            image__isnull=False
        ).first()
        item.refresh_from_db()
        with self.assertRaises(PermissionDenied):
            select_review_work_item_main_image(
                item.pk,
                expected_version=item.lock_version,
                prototype_id=target.pk,
                candidate_image_id=foreign.pk,
                reason="Foreign image probe",
                actor=self.admin_a,
            )

    def test_independent_operations_can_be_undone_by_id_in_any_scope_order(self):
        prototypes = list(FigurePrototype.objects.order_by("pk"))
        merge_source, merge_target = prototypes[0], prototypes[1]
        split_source = next(
            item for item in prototypes[2:] if item.versions.exists()
        )
        merge = merge_prototypes(
            merge_source.pk,
            merge_target.pk,
            reason="Independent merge A",
            actor=self.admin_a,
        )
        split_version = split_source.versions.first()
        split = split_prototype(
            split_source.pk,
            version_ids=[split_version.pk],
            title="Independent split B",
            reason="Independent split B",
            actor=self.admin_b,
        )
        undo_merge = undo_operation(
            merge.operation_id,
            reason="Undo merge by stable ID before later unrelated split",
            actor=self.admin_b,
        )
        undo_split = undo_operation(
            split.operation_id,
            reason="Undo split by stable ID",
            actor=self.admin_a,
        )
        self.assertEqual(undo_merge.undo_of_id, merge.pk)
        self.assertEqual(undo_split.undo_of_id, split.pk)
        merge_source.refresh_from_db()
        split_version.refresh_from_db()
        self.assertFalse(merge_source.is_merged)
        self.assertEqual(split_version.prototype_id, split_source.pk)

    def test_same_prototype_stale_version_is_rejected_without_silent_overwrite(self):
        prototype = FigurePrototype.objects.first()
        initial_version = prototype.domain_version
        maintain_prototype_metadata(
            prototype.pk,
            expected_version=initial_version,
            title="Administrator A title",
            reason="First concurrent-style update",
            actor=self.admin_a,
        )
        log_count = OperationLog.objects.count()
        with self.assertRaisesMessage(ValidationError, "conflict"):
            maintain_prototype_metadata(
                prototype.pk,
                expected_version=initial_version,
                title="Administrator B stale title",
                reason="Second concurrent-style update",
                actor=self.admin_b,
            )
        prototype.refresh_from_db()
        self.assertEqual(prototype.title, "Administrator A title")
        self.assertEqual(OperationLog.objects.count(), log_count)

    def test_dependent_operation_blocks_predecessor_undo_until_dependency_is_undone(self):
        first, target, dependent_source = list(FigurePrototype.objects.order_by("pk")[:3])
        predecessor = merge_prototypes(
            first.pk,
            target.pk,
            reason="Predecessor merge",
            actor=self.admin_a,
        )
        dependent = merge_prototypes(
            dependent_source.pk,
            target.pk,
            depends_on_operation_ids=[predecessor.operation_id],
            reason="Operation depending on predecessor merge",
            actor=self.admin_b,
        )
        with self.assertRaisesMessage(ValidationError, "active dependants"):
            undo_operation(
                predecessor.operation_id,
                reason="Unsafe predecessor undo probe",
                actor=self.admin_a,
            )
        undo_operation(
            dependent.operation_id,
            reason="Undo dependent operation first",
            actor=self.admin_b,
        )
        undo_operation(
            predecessor.operation_id,
            reason="Undo predecessor after dependency removal",
            actor=self.admin_a,
        )
        first.refresh_from_db()
        dependent_source.refresh_from_db()
        self.assertFalse(first.is_merged)
        self.assertFalse(dependent_source.is_merged)


class Val02bAdminHealthAndCompatibilityTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.admin = get_user_model().objects.get(username="fixture-admin")

    def test_health_wsgi_and_debug_false_path(self):
        from figure_gallery_poc.wsgi import application

        self.assertTrue(callable(application))
        self.assertIsNone(settings.WAGTAIL_GRAVATAR_PROVIDER_URL)
        self.assertFalse(settings.WAGTAIL_ENABLE_UPDATE_CHECK)
        with self.settings(DEBUG=False):
            response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "val02b-wagtail-spike")

    def test_browser_provision_emits_two_page_gallery_fixture_without_new_media(self):
        before_image_count = get_image_model().objects.count()
        output = StringIO()
        with mock.patch.dict(
            os.environ,
            {
                "VAL02B_ADMIN_PASSWORD": "runtime-browser-password",
                "VAL02B_CANDIDATE_TOKEN": "runtime-browser-client-token",
            },
        ):
            call_command("provision_val02b_browser", stdout=output)
        manifest = json.loads(output.getvalue().splitlines()[-1])
        clones = list(
            FigurePrototype.objects.filter(
                pk__in=manifest["pagination_prototype_ids"]
            ).order_by("pk")
        )
        self.assertEqual(len(clones), 2)
        character = clones[0].characters.get()
        source = (
            FigurePrototype.objects.filter(
                characters=character,
                main_image__isnull=False,
                live=True,
            )
            .exclude(pk__in=manifest["pagination_prototype_ids"])
            .order_by("pk")
            .first()
        )
        self.assertIsNotNone(source)
        self.assertEqual(clones[0].work_id, source.work_id)
        self.assertEqual(clones[0].manufacturer_id, source.manufacturer_id)
        self.assertEqual(clones[0].main_image_id, source.main_image_id)
        self.assertNotEqual(clones[1].main_image_id, source.main_image_id)
        self.assertEqual(get_image_model().objects.count(), before_image_count)
        self.assertIn(manifest["pagination_alias"], character.aliases)
        self.assertEqual(
            manifest["pagination_path"], f"/characters/{character.pk}/?page=2"
        )
        adult_image = CandidateImage.objects.get(
            pk=manifest["adult_candidate_image_id"]
        )
        adult_prototype = FigurePrototype.objects.get(pk=manifest["adult_prototype_id"])
        self.assertTrue(adult_image.is_adult)
        self.assertTrue(adult_image.selected_as_main)
        self.assertEqual(adult_image.prototype_id, adult_prototype.pk)
        self.assertEqual(adult_prototype.main_image_id, adult_image.image_id)
        self.assertFalse(SystemSetting.load().show_adult_images)

    def test_domain_admin_entry_is_accessible_and_settings_write_is_audited(self):
        self.client.force_login(self.admin)
        response = self.client.get("/admin/domain-operations/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data-testid="domain-operations"')
        changed = self.client.post(
            "/admin/domain-operations/",
            {
                "action": "settings",
                "reason": "Browser-drivable audited settings test",
                "payload": json.dumps({"show_adult_images": True}),
            },
        )
        self.assertEqual(changed.status_code, 302)
        self.assertTrue(SystemSetting.load().show_adult_images)
        self.assertTrue(
            OperationLog.objects.filter(
                related_records__action="system_settings",
                reason="Browser-drivable audited settings test",
            ).exists()
        )

    def test_every_generic_admin_model_entry_is_read_only(self):
        models = (
            Work,
            Character,
            Manufacturer,
            FigurePrototype,
            FigureVersion,
            SourceRecord,
            CandidateRecord,
            CandidateImage,
            SystemSetting,
            ReviewWorkItem,
            OperationLog,
            CandidateClientCredential,
            CandidateUploadReceipt,
        )
        for model in models:
            policy = model.snippet_viewset.permission_policy
            with self.subTest(model=model.__name__):
                self.assertTrue(policy.user_has_permission(self.admin, "view"))
                self.assertFalse(policy.user_has_permission(self.admin, "add"))
                self.assertFalse(policy.user_has_permission(self.admin, "change"))
                self.assertFalse(policy.user_has_permission(self.admin, "delete"))

    def test_domain_action_map_and_remaining_formal_services_are_audited(self):
        expected_actions = {
            "work",
            "character",
            "manufacturer_create",
            "manufacturer_status",
            "version",
            "prototype",
            "settings",
            "source_unavailable",
            "hide",
            "restore",
            "main_image",
            "merge",
            "split",
            "undo",
            "reopen_review",
        }
        self.assertEqual(
            {value for value, _label in DomainOperationForm.ACTIONS}, expected_actions
        )
        from gallery.views import domain_operations

        view_source = __import__("inspect").getsource(domain_operations)
        for action in expected_actions:
            with self.subTest(action=action):
                self.assertIn(f'"{action}"', view_source)

        work = maintain_work(
            name="Audited synthetic work",
            aliases=["Audited work alias"],
            reason="Exercise audited Work service",
            actor=self.admin,
        )
        maintain_character(
            display_name="Audited synthetic character",
            aliases=["Audited character alias"],
            work=work,
            reason="Exercise audited Character and aliases service",
            actor=self.admin,
        )
        prototype = FigurePrototype.objects.first()
        maintain_figure_version(
            prototype_id=prototype.pk,
            name="Audited synthetic version",
            kind=FigureVersion.Kind.BONUS,
            reason="Exercise audited FigureVersion service",
            actor=self.admin,
        )
        source = SourceRecord.objects.first()
        mark_source_unavailable(
            source.pk,
            unavailable=True,
            reason="Exercise audited source-unavailable service",
            actor=self.admin,
        )
        set_prototype_visibility(
            prototype.pk,
            hidden=True,
            reason="Exercise audited formal hide service",
            actor=self.admin,
        )
        set_prototype_visibility(
            prototype.pk,
            hidden=False,
            reason="Exercise audited formal restore service",
            actor=self.admin,
        )
        actions = set(
            OperationLog.objects.filter(
                related_records__action__in=[
                    "work_maintain",
                    "character_maintain",
                    "figure_version_maintain",
                    "source_availability",
                    "prototype_hide",
                    "prototype_restore",
                ]
            ).values_list("related_records__action", flat=True)
        )
        self.assertEqual(
            actions,
            {
                "work_maintain",
                "character_maintain",
                "figure_version_maintain",
                "source_availability",
                "prototype_hide",
                "prototype_restore",
            },
        )

    def test_treebeard_exact_pin_warning_visibility_and_tree_operations(self):
        self.assertEqual(enforce_validated_treebeard_version(), VALIDATED_TREEBEARD_VERSION)
        warning_ids = [item.id for item in checks.run_checks() if item.id == "treebeard.E001"]
        self.assertEqual(warning_ids, ["treebeard.E001", "treebeard.E001"])
        self.assertEqual(settings.SILENCED_SYSTEM_CHECKS, [])

        collection_root = Collection.get_first_root_node()
        collection = collection_root.add_child(name="VAL-02B treebeard collection probe")
        self.assertEqual(collection.depth, collection_root.depth + 1)
        self.assertTrue(collection.path.startswith(collection_root.path))
        collection.delete()

        page_root = Page.get_first_root_node()
        page = page_root.add_child(
            instance=Page(title="VAL-02B treebeard page probe", slug="val02b-tree-probe")
        )
        self.assertEqual(page.depth, page_root.depth + 1)
        self.assertTrue(page.path.startswith(page_root.path))
        page.delete()

        with mock.patch("gallery.treebeard_compat.version", return_value="6.0.0"):
            with self.assertRaises(ImproperlyConfigured):
                enforce_validated_treebeard_version()
