import copy
import json
import os
from pathlib import Path
import secrets
import sys
from unittest import mock

from django.contrib.auth import get_user_model

from gallery.candidate_service import CandidateIngressError, upsert_candidate
from gallery.client_identity import create_candidate_client
from gallery.models import (
    CandidateImage,
    CandidateRecord,
    Character,
    FigurePrototype,
    Manufacturer,
    OperationLog,
    SourceRecord,
)
from gallery.services import attach_candidate_to_version, select_main_image

from .base import SeededTestCase


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from spikes.val02_contract.python_candidate_client.client import CandidateClient


TEST_TOKEN = secrets.token_urlsafe(24)


def _payload(item_id="BOUNDARY-001", url="https://synthetic.invalid/boundary/one"):
    return {
        "source": {
            "source_type": "synthetic_test",
            "source_item_id": item_id,
            "source_url": url,
        },
        "raw_title": "Synthetic boundary candidate",
        "raw_character_names": ["Unknown synthetic character"],
        "raw_work_name": "Unknown synthetic work",
        "raw_manufacturer": "Unknown synthetic manufacturer",
        "raw_category": "scale",
        "raw_scale": "1/7",
        "raw_snapshot": {"revision": 1},
        "images": [],
    }


def _payload_for_existing(candidate, image, *, revision, changed_hash):
    source = candidate.source
    return {
        "source": {
            "source_type": source.source_type,
            "source_item_id": source.source_item_id,
            "source_url": source.source_url,
            "source_status": source.source_status,
            "raw_snapshot": {"recrawl_revision": revision},
        },
        "raw_title": candidate.raw_title,
        "raw_character_names": candidate.raw_character_names,
        "raw_work_name": candidate.raw_work_name,
        "raw_manufacturer": candidate.raw_manufacturer,
        "raw_category": candidate.raw_category,
        "raw_scale": candidate.raw_scale,
        "raw_release_date": candidate.raw_release_date,
        "raw_snapshot": {"recrawl_revision": revision},
        "images": [
            {
                "storage_key": image.storage_key,
                "source_url": (
                    f"https://synthetic.invalid/protected/changed-{revision}.png"
                ),
                "file_size": image.file_size + revision,
                "width": image.width,
                "height": image.height,
                "format": image.format,
                "sha256": changed_hash,
                "perceptual_hash": image.perceptual_hash,
                "is_adult": image.is_adult,
                "is_source_homepage": image.is_source_homepage,
                "present_in_latest_source": image.exists_in_latest_source,
            }
        ],
    }


class CandidateServiceTests(SeededTestCase):
    def test_source_upsert_is_idempotent(self):
        first = upsert_candidate(_payload())
        second = upsert_candidate(_payload())
        self.assertEqual(first["outcome"], "new")
        self.assertEqual(second["outcome"], "unchanged")
        self.assertEqual(first["source_id"], second["source_id"])
        self.assertEqual(first["candidate_id"], second["candidate_id"])

    def test_url_fallback_migrates_to_stable_id_without_duplicate(self):
        scenario = self.fixture["scenarios"]["url_fallback_migration"]
        initial = _payload("", scenario["initial_url"])
        initial["source"]["source_type"] = scenario["source_type"]
        initial_result = upsert_candidate(initial)
        later = copy.deepcopy(initial)
        later["source"]["source_item_id"] = scenario["later_source_item_id"]
        later["source"]["source_url"] = scenario["canonical_url"]
        later_result = upsert_candidate(later)
        self.assertTrue(later_result["migrated_from_url_fallback"])
        self.assertEqual(initial_result["source_id"], later_result["source_id"])
        self.assertEqual(
            SourceRecord.objects.filter(
                source_type=scenario["source_type"],
                source_item_id=scenario["later_source_item_id"],
            ).count(),
            1,
        )

    def test_unknown_names_stay_in_candidate_pool(self):
        character_count = Character.objects.count()
        manufacturer_count = Manufacturer.objects.count()
        result = upsert_candidate(_payload("BOUNDARY-002"))
        candidate = CandidateRecord.objects.get(pk=result["candidate_id"])
        self.assertEqual(Character.objects.count(), character_count)
        self.assertEqual(Manufacturer.objects.count(), manufacturer_count)
        self.assertEqual(candidate.status, CandidateRecord.Status.PENDING)
        self.assertEqual(candidate.unmatched_character_names, ["Unknown synthetic character"])
        self.assertEqual(
            candidate.unmatched_manufacturer_name, "Unknown synthetic manufacturer"
        )

    def test_candidate_service_rejects_formal_fields(self):
        for field in ("prototype", "characters", "manufacturer", "main_image_id"):
            candidate = _payload(f"FORBIDDEN-{field}")
            candidate[field] = 123
            with self.subTest(field=field), self.assertRaises(CandidateIngressError):
                upsert_candidate(candidate)

    def test_candidate_service_rejects_wagtail_image_link_fields(self):
        for field, value in (("image", {"id": 1}), ("image_id", 1)):
            candidate = _payload(f"FORBIDDEN-IMAGE-{field}")
            candidate["images"] = [
                {
                    "storage_key": f"synthetic/forbidden/{field}.png",
                    "source_url": f"https://synthetic.invalid/forbidden/{field}.png",
                    "format": "PNG",
                    "sha256": "a" * 64,
                    field: value,
                }
            ]
            with self.subTest(field=field), self.assertRaises(CandidateIngressError):
                upsert_candidate(candidate)
            self.assertFalse(
                SourceRecord.objects.filter(
                    source_type="synthetic_test",
                    source_item_id=f"FORBIDDEN-IMAGE-{field}",
                ).exists()
            )

    def test_candidate_sync_preserves_formal_and_selected_main_image_metadata(self):
        reviewer = get_user_model().objects.get(username="fixture-admin")
        candidate = CandidateRecord.objects.filter(target_version__isnull=False).first()
        attach_candidate_to_version(
            candidate.pk,
            candidate.target_version_id,
            reason="Prepare a reviewed source for the ingress boundary test",
            actor=reviewer,
        )
        candidate.refresh_from_db()
        source = candidate.source
        image = candidate.images.filter(image__isnull=False).first()
        prototype = candidate.target_prototype
        self.assertEqual(source.prototype_id, prototype.pk)
        self.assertEqual(image.prototype_id, prototype.pk)
        self.assertFalse(image.selected_as_main)

        formal_before = {
            "storage_key": image.storage_key,
            "sha256": image.sha256,
            "original_url": image.original_url,
            "image_id": image.image_id,
            "prototype_id": image.prototype_id,
            "selected_as_main": image.selected_as_main,
            "main_image_id": prototype.main_image_id,
        }
        result = upsert_candidate(
            _payload_for_existing(candidate, image, revision=2, changed_hash="0" * 64)
        )
        source.refresh_from_db()
        image.refresh_from_db()
        prototype.refresh_from_db()
        self.assertEqual(source.raw_snapshot, {"recrawl_revision": 2})
        self.assertEqual(
            result["protected_image_conflicts"][0]["candidate_image_id"], image.pk
        )
        self.assertTrue(
            {"original_url", "sha256"}
            <= set(result["protected_image_conflicts"][0]["fields"])
        )
        conflict_log = OperationLog.objects.filter(
            operation=OperationLog.Operation.CANDIDATE_UPSERT,
            related_records__candidate_id=candidate.pk,
        ).order_by("-pk").first()
        self.assertEqual(
            conflict_log.after_state["protected_image_conflicts"],
            result["protected_image_conflicts"],
        )
        self.assertEqual(
            {
                "storage_key": image.storage_key,
                "sha256": image.sha256,
                "original_url": image.original_url,
                "image_id": image.image_id,
                "prototype_id": image.prototype_id,
                "selected_as_main": image.selected_as_main,
                "main_image_id": prototype.main_image_id,
            },
            formal_before,
        )

        select_main_image(
            prototype.pk,
            image.pk,
            reason="Select the protected local image through the staff service",
            actor=reviewer,
        )
        image.refresh_from_db()
        prototype.refresh_from_db()
        main_before = {
            "storage_key": image.storage_key,
            "sha256": image.sha256,
            "original_url": image.original_url,
            "image_id": image.image_id,
            "prototype_id": image.prototype_id,
            "selected_as_main": image.selected_as_main,
            "main_image_id": prototype.main_image_id,
        }
        result = upsert_candidate(
            _payload_for_existing(candidate, image, revision=3, changed_hash="1" * 64)
        )
        source.refresh_from_db()
        image.refresh_from_db()
        prototype.refresh_from_db()
        self.assertEqual(source.raw_snapshot, {"recrawl_revision": 3})
        self.assertTrue(result["protected_image_conflicts"])
        self.assertEqual(
            {
                "storage_key": image.storage_key,
                "sha256": image.sha256,
                "original_url": image.original_url,
                "image_id": image.image_id,
                "prototype_id": image.prototype_id,
                "selected_as_main": image.selected_as_main,
                "main_image_id": prototype.main_image_id,
            },
            main_before,
        )

    def test_candidate_service_cannot_claim_formal_source_without_candidate(self):
        prototype = FigurePrototype.objects.first()
        source = SourceRecord.objects.create(
            source_type="synthetic_formal_only",
            source_item_id="FORMAL-ONLY-001",
            source_url="https://synthetic.invalid/formal-only/001",
            normalized_url="https://synthetic.invalid/formal-only/001",
            prototype=prototype,
        )
        candidate = _payload(
            source.source_item_id,
            source.source_url,
        )
        candidate["source"]["source_type"] = source.source_type
        with self.assertRaises(CandidateIngressError):
            upsert_candidate(candidate)
        self.assertFalse(CandidateRecord.objects.filter(source=source).exists())

    def test_main_image_request_is_reported_rejected_and_not_applied(self):
        prototype = FigurePrototype.objects.exclude(main_image=None).first()
        main_before = prototype.main_image_id
        candidate = _payload("BOUNDARY-ATTACK")
        candidate["requested_changes"] = {"main_image_id": "candidate-image"}
        result = upsert_candidate(candidate)
        prototype.refresh_from_db()
        self.assertEqual(result["rejected_fields"], ["main_image_id"])
        self.assertEqual(prototype.main_image_id, main_before)

    def test_candidate_metadata_images_are_recorded_without_download(self):
        candidate = _payload("BOUNDARY-MEDIA")
        candidate["images"] = [
            {
                "storage_key": "synthetic/candidate/metadata-only.png",
                "source_url": "https://synthetic.invalid/meta.png",
                "file_size": 123,
                "sha256": "a" * 64,
                "perceptual_hash": "b" * 16,
                "format": "PNG",
                "width": 20,
                "height": 30,
            }
        ]
        result = upsert_candidate(candidate)
        image = CandidateRecord.objects.get(pk=result["candidate_id"]).images.get()
        self.assertIsNone(image.image_id)
        self.assertEqual(image.storage_key, "synthetic/candidate/metadata-only.png")
        self.assertEqual(image.sha256, "a" * 64)

    def test_candidate_image_metadata_change_is_updated_then_idempotent(self):
        candidate = _payload("BOUNDARY-MEDIA-CHANGE")
        candidate["images"] = [
            {
                "storage_key": "synthetic/candidate/change.png",
                "source_url": "https://synthetic.invalid/change-v1.png",
                "file_size": 100,
                "sha256": "a" * 64,
                "format": "PNG",
                "width": 20,
                "height": 30,
            }
        ]
        first = upsert_candidate(candidate)
        changed = copy.deepcopy(candidate)
        changed["images"][0]["source_url"] = "https://synthetic.invalid/change-v2.png"
        changed["images"][0]["file_size"] = 101
        second = upsert_candidate(changed)
        third = upsert_candidate(changed)
        self.assertEqual(first["outcome"], "new")
        self.assertEqual(second["outcome"], "updated")
        self.assertEqual(third["outcome"], "unchanged")
        image = CandidateRecord.objects.get(pk=first["candidate_id"]).images.get()
        self.assertEqual(image.original_url, "https://synthetic.invalid/change-v2.png")
        self.assertEqual(image.file_size, 101)


class CandidateHttpTests(SeededTestCase):
    endpoint = "/api/val02/candidates/upsert/"
    client_id = "candidate-http-tests"

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        reviewer = get_user_model().objects.get(username="fixture-admin")
        create_candidate_client(
            client_id=cls.client_id,
            token=TEST_TOKEN,
            reason="Provision attributable HTTP test client",
            actor=reviewer,
        )

    def _post(
        self,
        candidate,
        token=TEST_TOKEN,
        operation="candidate_upsert",
        remote_addr="127.0.0.1",
    ):
        return self.client.post(
            self.endpoint,
            data=json.dumps(
                {
                    "protocol_version": 1,
                    "operation": operation,
                    "candidate": candidate,
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_X_CANDIDATE_CLIENT_ID=self.client_id,
            REMOTE_ADDR=remote_addr,
        )

    def test_requires_runtime_bearer_token(self):
        response = self._post(_payload("HTTP-AUTH"), token="incorrect")
        self.assertEqual(response.status_code, 401)

    def test_candidate_endpoint_is_loopback_only_and_ignores_forwarded_address(self):
        response = self.client.post(
            self.endpoint,
            data=json.dumps(
                {
                    "protocol_version": 1,
                    "operation": "candidate_upsert",
                    "candidate": _payload("HTTP-NON-LOOPBACK"),
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {TEST_TOKEN}",
            HTTP_X_FORWARDED_FOR="127.0.0.1",
            REMOTE_ADDR="198.51.100.23",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            SourceRecord.objects.filter(source_item_id="HTTP-NON-LOOPBACK").exists()
        )

    def test_only_candidate_upsert_operation_is_exposed(self):
        response = self._post(_payload("HTTP-FORMAL"), operation="prototype_update")
        self.assertEqual(response.status_code, 403)

    def test_http_idempotence_and_formal_counts(self):
        before = (Character.objects.count(), Manufacturer.objects.count(), FigurePrototype.objects.count())
        first = self._post(_payload("HTTP-IDEMPOTENT"))
        second = self._post(_payload("HTTP-IDEMPOTENT"))
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["candidate_id"], second.json()["candidate_id"])
        self.assertEqual(
            (Character.objects.count(), Manufacturer.objects.count(), FigurePrototype.objects.count()),
            before,
        )

    def test_http_rejects_direct_prototype_or_main_image_write(self):
        prototype_count = FigurePrototype.objects.count()
        for field in ("prototype", "main_image_id"):
            candidate = _payload(f"HTTP-{field}")
            candidate[field] = 1
            response = self._post(candidate)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(FigurePrototype.objects.count(), prototype_count)

    def test_http_rejects_nested_wagtail_image_link_fields(self):
        before = CandidateImage.objects.count()
        for field, value in (("image", {"id": 1}), ("image_id", 1)):
            candidate = _payload(f"HTTP-IMAGE-{field}")
            candidate["images"] = [
                {
                    "storage_key": f"synthetic/http-forbidden/{field}.png",
                    "source_url": f"https://synthetic.invalid/http-forbidden/{field}.png",
                    "format": "PNG",
                    "sha256": "a" * 64,
                    field: value,
                }
            ]
            with self.subTest(field=field):
                response = self._post(candidate)
                self.assertEqual(response.status_code, 403)
        self.assertEqual(CandidateImage.objects.count(), before)

    def test_every_candidate_upsert_has_operation_log(self):
        before = OperationLog.objects.count()
        response = self._post(_payload("HTTP-AUDIT"))
        self.assertEqual(response.status_code, 201)
        log = OperationLog.objects.order_by("-pk").first()
        self.assertGreater(OperationLog.objects.count(), before)
        self.assertEqual(log.operation, OperationLog.Operation.CANDIDATE_UPSERT)
        self.assertTrue(log.actor_label)
        self.assertTrue(log.reason)
        self.assertTrue(log.after_state)
        self.assertTrue(log.related_records)

    def test_shared_python_client_integrates_and_remains_candidate_only(self):
        fixture_candidate = next(
            item
            for item in self.fixture["candidate_records"]
            if item["id"] == "candidate-main-image-attack"
        )
        protected = FigurePrototype.objects.exclude(main_image=None).order_by("pk").first()
        main_before = protected.main_image_id
        formal_counts = (
            Character.objects.count(),
            Manufacturer.objects.count(),
            FigurePrototype.objects.count(),
        )

        def local_transport(request, timeout):
            del timeout
            request_headers = {
                key.lower(): value for key, value in request.header_items()
            }
            response = self.client.generic(
                request.get_method(),
                "/api/val02/candidates/upsert/",
                data=request.data,
                content_type="application/json",
                HTTP_AUTHORIZATION=request_headers["authorization"],
                HTTP_X_CANDIDATE_CLIENT_ID=request_headers[
                    "x-candidate-client-id"
                ],
            )
            return response.status_code, response.content

        environment = {
            "VAL02_WAGTAIL_CANDIDATE_TOKEN": TEST_TOKEN,
            "VAL02_WAGTAIL_CANDIDATE_CLIENT_ID": self.client_id,
            "VAL02_WAGTAIL_CANDIDATE_ENDPOINT": "http://127.0.0.1:8000/api/val02/candidates/upsert/",
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            client = CandidateClient.from_environment("wagtail", transport=local_transport)
            first = client.upsert_candidate(fixture_candidate)
            second = client.upsert_candidate(fixture_candidate)
        self.assertIn(first["outcome"], {"updated", "unchanged"})
        self.assertEqual(second["outcome"], "unchanged")
        self.assertIn("main_image_id", first["rejected_fields"])
        protected.refresh_from_db()
        self.assertEqual(protected.main_image_id, main_before)
        self.assertEqual(
            (
                Character.objects.count(),
                Manufacturer.objects.count(),
                FigurePrototype.objects.count(),
            ),
            formal_counts,
        )
