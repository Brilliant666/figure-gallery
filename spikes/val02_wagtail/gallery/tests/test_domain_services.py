from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError

from gallery.candidate_service import upsert_candidate
from gallery.models import (
    CandidateImage,
    CandidateRecord,
    FigurePrototype,
    FigureVersion,
    Manufacturer,
    OperationLog,
    SourceRecord,
    SystemSetting,
)
from gallery.services import (
    attach_candidate_to_version,
    create_manufacturer,
    create_prototype_from_candidate,
    decide_candidate_field,
    merge_prototypes,
    review_candidate_status,
    select_main_image,
    set_manufacturer_status,
    split_prototype,
    undo_last_operation,
    update_system_settings,
)

from .base import SeededTestCase


class DomainServiceTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.reviewer = get_user_model().objects.get(username="fixture-admin")

    def test_formal_operations_require_staff_reviewer(self):
        candidate = CandidateRecord.objects.first()
        with self.assertRaises(PermissionDenied):
            review_candidate_status(
                candidate.pk,
                status=CandidateRecord.Status.DEFERRED,
                reason="No anonymous review",
                actor=None,
            )

    def test_new_manufacturer_defaults_draft(self):
        item = create_manufacturer(
            name="New synthetic maker",
            aliases=["Synthetic maker alias"],
            reason="Reviewer created an unmatched manufacturer candidate",
            actor=self.reviewer,
        )
        self.assertEqual(item.status, Manufacturer.Status.DRAFT)
        visible_template = FigurePrototype.objects.exclude(main_image=None).first()
        character = visible_template.characters.first()
        draft_prototype = FigurePrototype.objects.create(
            title="Draft-maker synthetic public-filter probe",
            work=character.work,
            manufacturer=item,
            figure_type=FigurePrototype.FigureType.SCALE,
            scale="1/9",
            live=True,
            main_image=visible_template.main_image,
        )
        draft_prototype.characters.set([character])
        draft_prototype.save()
        response = self.client.get(f"/characters/{character.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(
            draft_prototype.pk,
            [card["prototype"].pk for card in response.context["cards"]],
        )
        set_manufacturer_status(
            item.pk,
            status=Manufacturer.Status.ACTIVE,
            reason="Reviewer verified the synthetic manufacturer",
            actor=self.reviewer,
        )
        item.refresh_from_db()
        self.assertEqual(item.status, Manufacturer.Status.ACTIVE)
        set_manufacturer_status(
            item.pk,
            status=Manufacturer.Status.HIDDEN,
            reason="Reviewer hid the synthetic manufacturer",
            actor=self.reviewer,
        )
        item.refresh_from_db()
        self.assertEqual(item.status, Manufacturer.Status.HIDDEN)
        actions = list(
            OperationLog.objects.filter(
                related_records__manufacturer_id=item.pk
            ).values_list("related_records", flat=True)
        )
        self.assertEqual(
            [record["action"] for record in actions],
            [
                "manufacturer_create_draft",
                "manufacturer_status",
                "manufacturer_status",
            ],
        )

    def test_system_settings_service_is_staff_only_transactional_and_audited(self):
        config = update_system_settings(
            show_adult_images=True,
            page_size=24,
            public_access_enabled=False,
            reason="Reviewer changed all synthetic public-gallery switches",
            actor=self.reviewer,
        )
        self.assertTrue(config.show_adult_images)
        self.assertEqual(config.page_size, 24)
        self.assertFalse(config.public_access_enabled)
        log = OperationLog.objects.get(
            related_records__action="system_settings",
            related_records__system_setting_id=config.pk,
        )
        self.assertFalse(log.before_state["show_adult_images"])
        self.assertTrue(log.after_state["show_adult_images"])
        self.assertEqual(log.after_state["page_size"], 24)
        self.assertFalse(log.after_state["public_access_enabled"])

        with self.assertRaises(PermissionDenied):
            update_system_settings(
                public_access_enabled=True,
                reason="Anonymous users cannot change settings",
                actor=None,
            )
        config.refresh_from_db()
        self.assertFalse(config.public_access_enabled)

        logs_before = OperationLog.objects.count()
        with self.assertRaises(ValidationError):
            update_system_settings(
                page_size=0,
                reason="Invalid page size must roll back",
                actor=self.reviewer,
            )
        config.refresh_from_db()
        self.assertEqual(config.page_size, 24)
        self.assertEqual(OperationLog.objects.count(), logs_before)

        with mock.patch(
            "gallery.services.OperationLog.objects.create",
            side_effect=RuntimeError("audit unavailable"),
        ):
            with self.assertRaises(RuntimeError):
                update_system_settings(
                    page_size=32,
                    reason="Audit failure must roll back settings",
                    actor=self.reviewer,
                )
        config.refresh_from_db()
        self.assertEqual(config.page_size, 24)

    def test_deferred_and_ignored_keep_reason(self):
        candidates = list(CandidateRecord.objects.order_by("pk")[:2])
        review_candidate_status(
            candidates[0].pk,
            status=CandidateRecord.Status.DEFERRED,
            reason="Need classification",
            actor=self.reviewer,
        )
        review_candidate_status(
            candidates[1].pk,
            status=CandidateRecord.Status.IGNORED,
            reason="Confirmed duplicate",
            actor=self.reviewer,
        )
        candidates[0].refresh_from_db()
        candidates[1].refresh_from_db()
        self.assertEqual(candidates[0].review_reason, "Need classification")
        self.assertEqual(candidates[1].review_reason, "Confirmed duplicate")
        for status in (CandidateRecord.Status.DEFERRED, CandidateRecord.Status.IGNORED):
            with self.subTest(status=status), self.assertRaises(ValidationError):
                review_candidate_status(
                    candidates[0].pk,
                    status=status,
                    reason="   ",
                    actor=self.reviewer,
                )

    def test_admin_creates_prototype_from_candidate_with_audit(self):
        candidate = CandidateRecord.objects.filter(target_prototype=None).first()
        character = FigurePrototype.objects.first().characters.first()
        maker = Manufacturer.objects.filter(status=Manufacturer.Status.ACTIVE).first()
        before = FigurePrototype.objects.count()
        prototype = create_prototype_from_candidate(
            candidate.pk,
            title="Reviewer-created synthetic prototype",
            manufacturer=maker,
            characters=[character],
            work=character.work,
            figure_type=FigurePrototype.FigureType.SCALE,
            scale="1/9",
            reason="Accepted after manual comparison",
            actor=self.reviewer,
        )
        self.assertEqual(FigurePrototype.objects.count(), before + 1)
        self.assertFalse(prototype.live)
        candidate.refresh_from_db()
        self.assertEqual(candidate.target_prototype_id, prototype.pk)
        self.assertTrue(
            OperationLog.objects.filter(
                operation=OperationLog.Operation.REVIEW,
                related_records__prototype_id=prototype.pk,
            ).exists()
        )

    def test_admin_attaches_candidate_to_existing_version(self):
        candidate = CandidateRecord.objects.filter(target_version=None).first()
        version = FigureVersion.objects.first()
        before = FigurePrototype.objects.count()
        attach_candidate_to_version(
            candidate.pk,
            version.pk,
            reason="Same sculpt and explicit version",
            actor=self.reviewer,
        )
        candidate.refresh_from_db()
        self.assertEqual(candidate.target_version_id, version.pk)
        self.assertEqual(candidate.target_prototype_id, version.prototype_id)
        self.assertEqual(FigurePrototype.objects.count(), before)

    def test_field_accept_and_reject_are_audited(self):
        candidate = CandidateRecord.objects.filter(target_prototype__isnull=False).first()
        candidate.raw_title = "Accepted synthetic title"
        candidate.save(update_fields=["raw_title", "updated_at"])
        original_scale = candidate.target_prototype.scale
        decide_candidate_field(
            candidate.pk,
            field_name="title",
            accept=True,
            reason="Title matches official synthetic card",
            actor=self.reviewer,
        )
        decide_candidate_field(
            candidate.pk,
            field_name="scale",
            accept=False,
            reason="Scale conflicts with reviewed record",
            actor=self.reviewer,
        )
        candidate.refresh_from_db()
        candidate.target_prototype.refresh_from_db()
        self.assertEqual(candidate.target_prototype.title, "Accepted synthetic title")
        self.assertEqual(candidate.target_prototype.scale, original_scale)
        self.assertEqual(candidate.field_decisions["title"]["decision"], "accept")
        self.assertEqual(candidate.field_decisions["scale"]["decision"], "reject")
        logs = list(
            OperationLog.objects.filter(
                operation=OperationLog.Operation.REVIEW,
                related_records__candidate_id=candidate.pk,
                related_records__field__in=["title", "scale"],
            ).order_by("pk")
        )
        self.assertEqual(len(logs), 2)
        self.assertEqual(
            [item.reason for item in logs],
            [
                "Title matches official synthetic card",
                "Scale conflicts with reviewed record",
            ],
        )
        self.assertEqual(
            [item.related_records["accepted"] for item in logs], [True, False]
        )

    def test_candidate_sync_never_replaces_existing_main_image(self):
        prototype = FigurePrototype.objects.exclude(main_image=None).first()
        before = prototype.main_image_id
        candidate = CandidateRecord.objects.get(raw_title__contains="资料更新")
        candidate.raw_snapshot["requested_changes"] = {"main_image_id": 999999}
        candidate.save(update_fields=["raw_snapshot", "updated_at"])
        prototype.refresh_from_db()
        self.assertEqual(prototype.main_image_id, before)

    def test_manual_main_image_selection_requires_owned_local_media(self):
        candidate_image = CandidateImage.objects.filter(image__isnull=False, candidate__isnull=False).first()
        prototype = FigurePrototype.objects.filter(main_image=None).first()
        candidate_image.prototype = prototype
        candidate_image.save(update_fields=["prototype", "updated_at"])
        select_main_image(
            prototype.pk,
            candidate_image.pk,
            reason="Human selected after visual review",
            actor=self.reviewer,
        )
        prototype.refresh_from_db()
        candidate_image.refresh_from_db()
        self.assertEqual(prototype.main_image_id, candidate_image.image_id)
        self.assertTrue(candidate_image.selected_as_main)
        stable_record_id = candidate_image.pk
        stable_storage_key = candidate_image.storage_key
        stable_media_id = candidate_image.image_id
        candidate_image.original_url = "https://changed.synthetic.invalid/metadata-only.png"
        candidate_image.save(update_fields=["original_url", "updated_at"])
        candidate_image.refresh_from_db()
        prototype.refresh_from_db()
        self.assertEqual(candidate_image.pk, stable_record_id)
        self.assertEqual(candidate_image.storage_key, stable_storage_key)
        self.assertEqual(candidate_image.image_id, stable_media_id)
        self.assertEqual(prototype.main_image_id, stable_media_id)

    def _prepare_merge_relations(self, source):
        candidate = CandidateRecord.objects.first()
        version = source.versions.first()
        candidate.source.prototype = source
        candidate.source.save(update_fields=["prototype", "updated_at"])
        candidate.target_prototype = source
        candidate.target_version = version
        candidate.review_reason = "Keep this audit reason"
        candidate.save(
            update_fields=[
                "target_prototype",
                "target_version",
                "review_reason",
                "updated_at",
            ]
        )
        image = candidate.images.filter(image__isnull=False).first()
        image.prototype = source
        image.save(update_fields=["prototype", "updated_at"])
        return candidate, image

    def test_split_rejects_foreign_ids_and_incomplete_relation_groups(self):
        source, other = list(FigurePrototype.objects.order_by("pk")[:2])
        before = FigurePrototype.objects.count()
        with self.assertRaises(ValidationError):
            split_prototype(
                source.pk,
                version_ids=[other.versions.first().pk],
                title="Must not exist",
                reason="Foreign relation probe",
                actor=self.reviewer,
            )
        self.assertEqual(FigurePrototype.objects.count(), before)

        candidate, image = self._prepare_merge_relations(source)
        with self.assertRaises(ValidationError):
            split_prototype(
                source.pk,
                candidate_ids=[candidate.pk],
                title="Must not exist either",
                reason="Incomplete relation probe",
                actor=self.reviewer,
            )
        candidate.refresh_from_db()
        image.refresh_from_db()
        self.assertEqual(candidate.target_prototype_id, source.pk)
        self.assertEqual(image.prototype_id, source.pk)
        self.assertEqual(FigurePrototype.objects.count(), before)

    def test_service_validation_failures_roll_back_unlogged_relation_changes(self):
        candidate = CandidateRecord.objects.filter(target_prototype=None).first()
        target = FigurePrototype.objects.first()
        candidate.raw_category = "unsupported-formal-type"
        candidate.save(update_fields=["raw_category", "updated_at"])
        logs_before = OperationLog.objects.count()
        with self.assertRaises(ValidationError):
            decide_candidate_field(
                candidate.pk,
                field_name="figure_type",
                accept=True,
                reason="Must roll back target association",
                actor=self.reviewer,
                target_prototype_id=target.pk,
            )
        candidate.refresh_from_db()
        self.assertIsNone(candidate.target_prototype_id)

        metadata_only = CandidateImage.objects.create(
            candidate=candidate,
            storage_key="synthetic/rollback/no-local-media.png",
            original_url="https://synthetic.invalid/rollback/no-local-media.png",
            format="PNG",
            sha256="f" * 64,
        )
        with self.assertRaises(ValidationError):
            select_main_image(
                target.pk,
                metadata_only.pk,
                reason="Must roll back image association",
                actor=self.reviewer,
                attach_if_unassigned=True,
            )
        metadata_only.refresh_from_db()
        self.assertIsNone(metadata_only.prototype_id)
        self.assertEqual(OperationLog.objects.count(), logs_before)

    def test_all_domain_write_services_emit_complete_operation_logs(self):
        first_new_log_id = (OperationLog.objects.order_by("-pk").first().pk + 1)
        maker = Manufacturer.objects.filter(status=Manufacturer.Status.ACTIVE).first()
        character = FigurePrototype.objects.first().characters.first()

        audited_maker = create_manufacturer(
            name="Audit-only synthetic manufacturer",
            reason="Reviewer created a draft manufacturer",
            actor=self.reviewer,
        )
        set_manufacturer_status(
            audited_maker.pk,
            status=Manufacturer.Status.ACTIVE,
            reason="Reviewer activated the manufacturer",
            actor=self.reviewer,
        )
        set_manufacturer_status(
            audited_maker.pk,
            status=Manufacturer.Status.HIDDEN,
            reason="Reviewer hid the manufacturer",
            actor=self.reviewer,
        )
        update_system_settings(
            show_adult_images=True,
            page_size=20,
            public_access_enabled=False,
            reason="Reviewer changed the gallery switches",
            actor=self.reviewer,
        )

        upsert = upsert_candidate(
            {
                "source": {
                    "source_type": "synthetic_audit",
                    "source_item_id": "AUDIT-001",
                    "source_url": "https://synthetic.invalid/audit/001",
                },
                "raw_title": "Synthetic audit candidate",
                "raw_character_names": [character.display_name],
                "raw_manufacturer": maker.name,
                "raw_category": "scale",
                "images": [],
            },
            actor_label="synthetic-audit-client",
        )
        audit_candidate = CandidateRecord.objects.get(pk=upsert["candidate_id"])
        review_candidate_status(
            CandidateRecord.objects.exclude(pk=audit_candidate.pk).first().pk,
            status=CandidateRecord.Status.DEFERRED,
            reason="Awaiting a documented classification",
            actor=self.reviewer,
        )
        created = create_prototype_from_candidate(
            audit_candidate.pk,
            title="Audit-created synthetic prototype",
            manufacturer=maker,
            characters=[character],
            work=character.work,
            reason="Reviewer accepted the complete candidate",
            actor=self.reviewer,
        )
        attach_candidate = (
            CandidateRecord.objects.exclude(pk=audit_candidate.pk)
            .filter(target_version=None)
            .first()
        )
        attach_candidate_to_version(
            attach_candidate.pk,
            created.versions.get().pk,
            reason="Reviewer matched the existing version",
            actor=self.reviewer,
        )
        field_candidate = CandidateRecord.objects.filter(
            target_prototype__isnull=False
        ).first()
        decide_candidate_field(
            field_candidate.pk,
            field_name="scale",
            accept=False,
            reason="Reviewer rejected conflicting scale metadata",
            actor=self.reviewer,
        )
        candidate_image = attach_candidate.images.filter(image__isnull=False).first()
        select_main_image(
            created.pk,
            candidate_image.pk,
            reason="Reviewer selected a local synthetic image",
            actor=self.reviewer,
        )

        split_image = CandidateImage.objects.create(
            prototype=created,
            image=created.main_image,
            storage_key="synthetic/audit/split-only.png",
            original_url="https://synthetic.invalid/audit/split-only.png",
            format="PNG",
            sha256="e" * 64,
        )
        split_prototype(
            created.pk,
            candidate_image_ids=[split_image.pk],
            title="Audit split synthetic prototype",
            reason="Reviewer separated a misplaced image",
            actor=self.reviewer,
        )
        undo_last_operation(reason="Reviewer reversed the split", actor=self.reviewer)
        merge_target = FigurePrototype.objects.exclude(pk=created.pk).first()
        merge_prototypes(
            created.pk,
            merge_target.pk,
            reason="Reviewer merged confirmed duplicates",
            actor=self.reviewer,
        )
        undo_last_operation(reason="Reviewer reversed the merge", actor=self.reviewer)

        logs = list(OperationLog.objects.filter(pk__gte=first_new_log_id).order_by("pk"))
        self.assertEqual(
            {item.operation for item in logs}, set(OperationLog.Operation.values)
        )
        self.assertTrue(
            {
                "manufacturer_create_draft",
                "manufacturer_status",
                "system_settings",
            }
            <= {
                item.related_records.get("action")
                for item in logs
                if isinstance(item.related_records, dict)
            }
        )
        for item in logs:
            with self.subTest(operation=item.operation, log_id=item.pk):
                self.assertTrue(item.actor_id or item.actor_label)
                self.assertIsNotNone(item.created_at)
                self.assertTrue(item.operation)
                self.assertTrue(item.reason.strip())
                self.assertIsInstance(item.before_state, dict)
                self.assertIsInstance(item.after_state, dict)
                self.assertTrue(item.related_records)
        for model in (CandidateRecord, FigurePrototype, Manufacturer, SystemSetting):
            policy = model.snippet_viewset.permission_policy
            with self.subTest(read_only_model=model.__name__):
                self.assertTrue(policy.user_has_permission(self.reviewer, "view"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "add"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "change"))
                self.assertFalse(policy.user_has_permission(self.reviewer, "delete"))

    def test_merge_split_and_two_undos_restore_cross_record_relations(self):
        target, source = list(FigurePrototype.objects.order_by("pk")[:2])
        candidate, image = self._prepare_merge_relations(source)
        original_version_ids = list(source.versions.values_list("pk", flat=True))
        original_source_ids = list(source.sources.values_list("pk", flat=True))
        merge = merge_prototypes(
            source.pk, target.pk, reason="Test duplicate merge", actor=self.reviewer
        )
        source.refresh_from_db()
        self.assertTrue(source.is_merged)
        self.assertEqual(candidate.__class__.objects.get(pk=candidate.pk).target_prototype_id, target.pk)
        split = split_prototype(
            target.pk,
            version_ids=original_version_ids,
            source_ids=original_source_ids,
            candidate_ids=[candidate.pk],
            candidate_image_ids=[image.pk],
            title="Split synthetic prototype",
            reason="Relationships belonged to another sculpt",
            actor=self.reviewer,
        )
        new_id = split.related_records["new_prototype_id"]
        self.assertEqual(FigureVersion.objects.get(pk=original_version_ids[0]).prototype_id, new_id)
        undo_split = undo_last_operation(reason="Undo split test", actor=self.reviewer)
        self.assertEqual(undo_split.undo_of_id, split.pk)
        self.assertEqual(FigureVersion.objects.get(pk=original_version_ids[0]).prototype_id, target.pk)
        undo_merge = undo_last_operation(reason="Undo merge test", actor=self.reviewer)
        self.assertEqual(undo_merge.undo_of_id, merge.pk)
        source.refresh_from_db()
        candidate.refresh_from_db()
        image.refresh_from_db()
        self.assertFalse(source.is_merged)
        self.assertEqual(candidate.target_prototype_id, source.pk)
        self.assertEqual(image.prototype_id, source.pk)
        self.assertEqual(candidate.review_reason, "Keep this audit reason")
        self.assertTrue(SourceRecord.objects.filter(pk__in=original_source_ids, prototype=source).exists())

    def test_merge_is_atomic_when_audit_write_fails(self):
        target, source = list(FigurePrototype.objects.order_by("pk")[:2])
        version_ids = list(source.versions.values_list("pk", flat=True))
        with mock.patch("gallery.services.OperationLog.objects.create", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError):
                merge_prototypes(source.pk, target.pk, reason="Must rollback", actor=self.reviewer)
        source.refresh_from_db()
        self.assertFalse(source.is_merged)
        self.assertEqual(
            set(FigureVersion.objects.filter(pk__in=version_ids).values_list("prototype_id", flat=True)),
            {source.pk},
        )
