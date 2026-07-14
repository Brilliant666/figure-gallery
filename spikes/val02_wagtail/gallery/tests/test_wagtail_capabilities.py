from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.conf import settings
from django.core.management import call_command
from django.core.files.storage import Storage
from django.urls import reverse
from django.utils.module_loading import import_string
from wagtail.models import Task, Workflow, WorkflowContentType, WorkflowTask

from gallery.models import (
    CandidateImage,
    CandidateRecord,
    FigurePrototype,
    Manufacturer,
    OperationLog,
    SystemSetting,
)

from .base import SeededTestCase


class WagtailCapabilityTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.reviewer = get_user_model().objects.get(username="fixture-admin")

    def test_non_page_model_revision_round_trip_and_publish(self):
        prototype = FigurePrototype.objects.first()
        original_title = prototype.title
        prototype.title = "Unpublished revision title"
        revision = prototype.save_revision(user=self.reviewer)
        prototype.refresh_from_db()
        self.assertEqual(prototype.title, original_title)
        self.assertEqual(revision.as_object().title, "Unpublished revision title")
        revision.publish(user=self.reviewer)
        prototype.refresh_from_db()
        self.assertEqual(prototype.title, "Unpublished revision title")
        self.assertEqual(prototype.live_revision_id, revision.pk)

    def test_non_page_model_workflow_can_start(self):
        prototype = FigurePrototype.objects.first()
        workflow = Workflow.objects.create(name="Synthetic prototype review")
        task = Task.objects.create(name="Synthetic editorial approval")
        WorkflowTask.objects.create(workflow=workflow, task=task, sort_order=1)
        WorkflowContentType.objects.create(
            workflow=workflow,
            content_type=ContentType.objects.get_for_model(FigurePrototype),
        )
        self.assertEqual(prototype.get_workflow(), workflow)
        prototype.save_revision(user=self.reviewer)
        state = workflow.start(prototype, self.reviewer)
        self.assertEqual(state.object_id, str(prototype.pk))
        self.assertEqual(state.status, state.STATUS_IN_PROGRESS)

    def test_wagtail_image_rendition_is_created_and_rebuildable(self):
        prototype = FigurePrototype.objects.exclude(main_image=None).first()
        rendition = prototype.main_image.get_rendition("max-24x24")
        self.assertLessEqual(rendition.width, 24)
        self.assertLessEqual(rendition.height, 24)
        image_id = rendition.image_id
        rendition.delete()
        rebuilt = prototype.main_image.get_rendition("max-24x24")
        self.assertEqual(rebuilt.image_id, image_id)
        self.assertTrue(rebuilt.file.name)

    def test_seed_reset_repeats_with_serializable_storage_location(self):
        self.assertIsInstance(
            settings.STORAGES["default"]["OPTIONS"]["location"], str
        )
        expected = None
        for _ in range(2):
            call_command("seed_synthetic", "--reset", verbosity=0)
            observed = {
                "prototypes": FigurePrototype.objects.count(),
                "candidates": CandidateRecord.objects.count(),
                "images": CandidateImage.objects.count(),
            }
            expected = expected or observed
            self.assertEqual(observed, expected)
        self.assertEqual(
            expected,
            {"prototypes": 5, "candidates": 4, "images": 11},
        )

    def test_local_and_s3_backends_share_django_storage_contract(self):
        local = import_string("django.core.files.storage.FileSystemStorage")
        s3 = import_string("storages.backends.s3.S3Storage")
        self.assertTrue(issubclass(local, Storage))
        self.assertTrue(issubclass(s3, Storage))

    def test_admin_candidate_review_page_and_viewset_are_available(self):
        self.client.force_login(self.reviewer)
        candidate = FigurePrototype.objects.first().candidates.first()
        if candidate is None:
            from gallery.models import CandidateRecord

            candidate = CandidateRecord.objects.first()
        response = self.client.get(f"/admin/candidate-review/{candidate.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Candidate-only fields")
        self.assertContains(response, "Create new prototype")
        self.assertContains(response, "Select main image manually")

    def test_generic_snippet_forms_are_read_only_even_for_superuser(self):
        for model in (CandidateRecord, FigurePrototype, Manufacturer, SystemSetting):
            policy = model.snippet_viewset.permission_policy
            with self.subTest(model=model.__name__):
                self.assertTrue(policy.user_has_permission(self.reviewer, "view"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "add"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "change"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "delete"))

        self.client.force_login(self.reviewer)
        prototype = FigurePrototype.objects.exclude(main_image=None).first()
        title_before = prototype.title
        main_before = prototype.main_image_id
        log_count = OperationLog.objects.count()
        edit_url = reverse(
            FigurePrototype.snippet_viewset.get_url_name("edit"),
            args=[prototype.pk],
        )
        response = self.client.post(
            edit_url,
            {"title": "Bypass attempt", "main_image": ""},
        )
        self.assertIn(response.status_code, {302, 403})
        prototype.refresh_from_db()
        self.assertEqual(prototype.title, title_before)
        self.assertEqual(prototype.main_image_id, main_before)
        self.assertEqual(OperationLog.objects.count(), log_count)
