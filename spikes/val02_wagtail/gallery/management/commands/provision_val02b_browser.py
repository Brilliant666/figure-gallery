"""Provision a TEMP-only synthetic browser scenario without printing secrets."""

import json
import os

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from gallery.client_identity import create_candidate_client, rotate_candidate_client_token
from gallery.models import (
    CandidateClientCredential,
    CandidateImage,
    CandidateRecord,
    FigurePrototype,
    ReviewWorkItem,
)
from gallery.services import create_review_work_item, select_main_image


class Command(BaseCommand):
    help = (
        "Reset synthetic data and provision a browser review. Password and candidate "
        "token come from runtime environment variables and are never printed."
    )

    def add_arguments(self, parser):
        parser.add_argument("--no-reset", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.getenv("VAL02B_ADMIN_PASSWORD", "")
        candidate_token = os.getenv("VAL02B_CANDIDATE_TOKEN", "")
        if not password or not candidate_token:
            raise CommandError(
                "VAL02B_ADMIN_PASSWORD and VAL02B_CANDIDATE_TOKEN are required at runtime."
            )
        if not options["no_reset"]:
            call_command("seed_synthetic", "--reset", verbosity=0)

        user_model = get_user_model()
        admin, _ = user_model.objects.get_or_create(
            username="fixture-admin",
            defaults={"is_staff": True, "is_superuser": True},
        )
        admin.is_staff = True
        admin.is_superuser = True
        admin.is_active = True
        admin.set_password(password)
        admin.save()

        client_id = "val02b-browser-client"
        if CandidateClientCredential.objects.filter(client_id=client_id).exists():
            rotate_candidate_client_token(
                client_id,
                token=candidate_token,
                reason="Rotate disposable VAL-02B browser client token",
                actor=admin,
            )
        else:
            create_candidate_client(
                client_id=client_id,
                token=candidate_token,
                reason="Provision disposable VAL-02B browser scenario",
                actor=admin,
            )
        candidate = (
            CandidateRecord.objects.filter(target_prototype__isnull=False)
            .order_by("pk")
            .first()
        )
        if candidate is None:
            raise CommandError("Synthetic seed did not provide a reviewable candidate.")

        pagination_source = (
            FigurePrototype.objects.filter(
                characters__name_en="Lin Orbit",
                main_image__isnull=False,
                live=True,
            )
            .select_related("work", "manufacturer", "main_image")
            .prefetch_related("characters")
            .order_by("pk")
            .first()
        )
        if pagination_source is None:
            raise CommandError("Synthetic seed did not provide the Orbit Lin gallery item.")
        pagination_character = pagination_source.characters.order_by("pk").first()
        if pagination_character is None or not pagination_character.aliases:
            raise CommandError("Orbit Lin fixture must expose a deterministic search alias.")
        alternate_image = (
            pagination_source.main_image.__class__.objects.filter(
                title="media-prototype-05-main"
            ).first()
            or pagination_source.main_image.__class__.objects.exclude(
                pk=pagination_source.main_image_id
            ).order_by("pk").first()
        )
        if alternate_image is None:
            raise CommandError("Synthetic seed did not provide an alternate gallery image.")
        pagination_clones = []
        for index, main_image in enumerate(
            (pagination_source.main_image, alternate_image), start=1
        ):
            clone, _created = FigurePrototype.objects.update_or_create(
                title=f"VAL-02B synthetic pagination clone {index}",
                defaults={
                    "work": pagination_source.work,
                    "manufacturer": pagination_source.manufacturer,
                    "figure_type": pagination_source.figure_type,
                    "scale": pagination_source.scale,
                    "costume_skin_text": f"Synthetic pagination fixture {index}",
                    "is_multi_character": False,
                    "is_adult": False,
                    "is_hidden": False,
                    "is_soft_deleted": False,
                    "is_merged": False,
                    "merged_into": None,
                    "main_image": main_image,
                    "live": True,
                },
            )
            clone.characters.set(pagination_source.characters.all())
            clone.save()
            pagination_clones.append(clone)

        adult_image = (
            CandidateImage.objects.filter(
                candidate__target_prototype__isnull=False,
                image__isnull=False,
                is_adult=True,
            )
            .select_related("candidate__target_prototype")
            .order_by("pk")
            .first()
        )
        if adult_image is None:
            raise CommandError("Synthetic seed did not provide an adult candidate image.")
        adult_prototype = adult_image.candidate.target_prototype
        if adult_image.prototype_id != adult_prototype.pk:
            adult_image.prototype = adult_prototype
            adult_image.save(update_fields=["prototype", "updated_at"])
        select_main_image(
            adult_prototype.pk,
            adult_image.pk,
            reason="Provision adult-visibility browser boundary",
            actor=admin,
        )

        ReviewWorkItem.objects.filter(candidate=candidate).delete()
        work_item = create_review_work_item(
            candidate.pk,
            allowed_target_ids=[candidate.target_prototype_id],
            reason="Provision disposable VAL-02B browser review work item",
            actor=admin,
        )
        self.stdout.write(
            json.dumps(
                {
                    "synthetic_only": True,
                    "admin_username": admin.username,
                    "login_url": "/admin/login/",
                    "candidate_id": candidate.pk,
                    "candidate_image_ids": list(
                        candidate.images.order_by("pk").values_list("pk", flat=True)
                    ),
                    "work_item_id": work_item.pk,
                    "work_item_version": work_item.lock_version,
                    "allowed_target_ids": list(
                        work_item.allowed_targets.values_list("pk", flat=True)
                    ),
                    "adult_candidate_image_id": adult_image.pk,
                    "adult_prototype_id": adult_prototype.pk,
                    "review_url": f"/admin/candidate-review/{candidate.pk}/",
                    "pagination_alias": pagination_character.aliases[0],
                    "pagination_path": f"/characters/{pagination_character.pk}/?page=2",
                    "pagination_prototype_ids": [
                        prototype.pk for prototype in pagination_clones
                    ],
                    "pagination_image_ids": [
                        prototype.main_image_id for prototype in pagination_clones
                    ],
                    "secrets_printed": False,
                },
                sort_keys=True,
            )
        )
