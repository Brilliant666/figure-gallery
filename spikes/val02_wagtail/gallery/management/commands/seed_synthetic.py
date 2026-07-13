import hashlib
import json
from io import BytesIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.dateparse import parse_datetime
from PIL import Image as PILImage
from wagtail.images import get_image_model
from wagtail.models import Collection

from gallery.candidate_service import normalize_source_url, upsert_candidate
from gallery.models import (
    CandidateImage,
    CandidateRecord,
    Character,
    FigurePrototype,
    FigureVersion,
    Manufacturer,
    OperationLog,
    SourceRecord,
    SystemSetting,
    Work,
)
from gallery.services import select_main_image


def _png_bytes(generator):
    image = PILImage.new(
        "RGBA",
        (int(generator["width"]), int(generator["height"])),
        tuple(generator["rgba"]),
    )
    stream = BytesIO()
    image.save(stream, format="PNG", optimize=False)
    return stream.getvalue()


def _average_hash(binary):
    with PILImage.open(BytesIO(binary)) as image:
        gray = image.convert("L").resize((8, 8))
        pixels = list(gray.getdata())
    mean = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= mean else "0" for pixel in pixels)
    return f"{int(bits, 2):016x}"


def _synthetic_collection():
    root = Collection.get_first_root_node()
    current = root.get_children().filter(name="VAL-02 synthetic").first()
    return current or root.add_child(name="VAL-02 synthetic")


def _create_wagtail_image(spec, collection):
    binary = _png_bytes(spec["generator"])
    safe_name = f"{spec['id']}.png"
    image = get_image_model().objects.create(
        title=spec["id"],
        collection=collection,
        file=ContentFile(binary, name=safe_name),
    )
    return image, binary


class Command(BaseCommand):
    help = "Seed the shared, entirely synthetic VAL-02 fixture and generated PNGs."

    def add_arguments(self, parser):
        default = Path(__file__).resolve().parents[4] / "val02_contract" / "fixtures" / "domain_fixture.json"
        parser.add_argument("--fixture", default=str(default))
        parser.add_argument("--reset", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        fixture_path = Path(options["fixture"]).resolve()
        if not fixture_path.is_file():
            raise CommandError(f"fixture not found: {fixture_path}")
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        if payload.get("schema_version") != 1 or payload.get("synthetic_only") is not True:
            raise CommandError("Only the version-1 synthetic fixture is accepted.")
        if payload.get("media_policy", {}).get("binary_committed") is not False:
            raise CommandError("Fixture must prohibit committed media binaries.")

        collection = _synthetic_collection()
        if options["reset"]:
            OperationLog.objects.all().delete()
            CandidateImage.objects.all().delete()
            CandidateRecord.objects.all().delete()
            SourceRecord.objects.all().delete()
            FigureVersion.objects.all().delete()
            FigurePrototype.objects.all().delete()
            Character.objects.all().delete()
            Work.objects.all().delete()
            Manufacturer.objects.all().delete()
            SystemSetting.objects.all().delete()
            get_image_model().objects.filter(collection=collection).delete()

        if Work.objects.exists() or FigurePrototype.objects.exists():
            raise CommandError("Prototype data already exists; pass --reset for a deterministic reseed.")

        works = {
            item["id"]: Work.objects.create(
                name=item["name"],
                original_name=item.get("original_name", ""),
                aliases=item.get("aliases", []),
            )
            for item in payload["works"]
        }
        characters = {}
        for item in payload["characters"]:
            names = item.get("names", {})
            characters[item["id"]] = Character.objects.create(
                display_name=item["display_name"],
                name_zh=names.get("zh", ""),
                name_ja=names.get("ja", ""),
                name_en=names.get("en", ""),
                aliases=item.get("aliases", []),
                work=works.get(item.get("work_id")),
                is_hidden=item.get("status") == "hidden",
                is_soft_deleted=item.get("soft_deleted", False),
            )
        manufacturers = {
            item["id"]: Manufacturer.objects.create(
                name=item["canonical_name"],
                aliases=item.get("aliases", []),
                status=item["status"],
            )
            for item in payload["manufacturers"]
        }
        prototypes = {}
        for item in payload["figure_prototypes"]:
            prototype = FigurePrototype.objects.create(
                title=item["title"],
                work=works.get(item.get("work_id")),
                manufacturer=manufacturers[item["manufacturer_id"]],
                figure_type=item["figure_type"],
                scale=item.get("scale") or "",
                costume_skin_text=item.get("costume_text", ""),
                is_multi_character=item.get("is_group", False),
                is_adult=item.get("is_adult", False),
                is_soft_deleted=item.get("soft_deleted", False),
                live=item.get("publication_status") == "published",
            )
            prototype.characters.set([characters[key] for key in item["character_ids"]])
            prototype.save()
            prototypes[item["id"]] = prototype

        versions = {}
        for item in payload["figure_versions"]:
            versions[item["id"]] = FigureVersion.objects.create(
                prototype=prototypes[item["prototype_id"]],
                name=item["name"],
                kind=item["kind"],
            )

        for item in payload["source_records"]:
            SourceRecord.objects.create(
                prototype=prototypes[item["prototype_id"]],
                source_type=item["source_type"],
                source_item_id=item.get("source_item_id") or "",
                source_url=item["source_url"],
                normalized_url=normalize_source_url(item["source_url"]),
                source_status=item.get("source_status", ""),
                last_synced_at=parse_datetime(item.get("last_synced_at", "")),
                is_unavailable=item.get("is_stale", False),
                raw_snapshot=item.get("raw_snapshot", {}),
            )

        User = get_user_model()
        reviewer, _ = User.objects.get_or_create(
            username="fixture-admin", defaults={"is_staff": True, "is_superuser": True}
        )
        reviewer.is_staff = True
        reviewer.is_superuser = True
        reviewer.set_unusable_password()
        reviewer.save()

        media_records = {}
        for spec in payload["media"]:
            image, binary = _create_wagtail_image(spec, collection)
            owner = prototypes[spec["owner_id"]]
            media_records[spec["id"]] = CandidateImage.objects.create(
                prototype=owner,
                image=image,
                original_url=spec.get("source_url", ""),
                storage_key=spec["storage_key"],
                file_size=len(binary),
                width=image.width,
                height=image.height,
                format=spec.get("format", "PNG"),
                sha256=hashlib.sha256(binary).hexdigest(),
                perceptual_hash=_average_hash(binary),
                is_adult=spec.get("is_adult", False),
                is_source_homepage=spec.get("is_source_homepage", False),
                exists_in_latest_source=spec.get("present_in_latest_source", True),
            )

        candidates = {}
        for item in payload["candidate_records"]:
            source = item["source"]
            result = upsert_candidate(
                {
                    "source": {
                        "source_type": source["source_type"],
                        "source_item_id": source.get("source_item_id") or "",
                        "source_url": source["source_url"],
                        "source_status": source.get("source_status", ""),
                        "is_unavailable": source.get("is_stale", False),
                    },
                    "raw_title": item["raw_title"],
                    "raw_character_names": item.get("raw_character_names", []),
                    "raw_work_name": item.get("raw_work_name", ""),
                    "raw_manufacturer": item.get("raw_manufacturer", ""),
                    "raw_category": "scale" if item.get("raw_category") == "比例手办" else "prize",
                    "raw_scale": item.get("raw_scale") or "",
                    "raw_release_date": item.get("raw_date") or "",
                    "raw_snapshot": {
                        **item.get("raw_snapshot", {}),
                        "requested_changes": item.get("requested_changes", {}),
                    },
                },
                actor_label="synthetic-fixture-seed",
            )
            candidate = CandidateRecord.objects.get(pk=result["candidate_id"])
            candidate.status = item["status"]
            candidate.review_reason = item.get("reason") or ""
            candidate.target_prototype = prototypes.get(item.get("target_prototype_id"))
            candidate.target_version = versions.get(item.get("target_version_id"))
            candidate.save()
            candidates[item["id"]] = candidate
            for spec in item["images"]:
                image, binary = _create_wagtail_image(spec, collection)
                CandidateImage.objects.update_or_create(
                    candidate=candidate,
                    storage_key=spec["storage_key"],
                    defaults={
                        "image": image,
                        "original_url": spec.get("source_url", ""),
                        "file_size": len(binary),
                        "width": image.width,
                        "height": image.height,
                        "format": spec.get("format", "PNG"),
                        "sha256": hashlib.sha256(binary).hexdigest(),
                        "perceptual_hash": _average_hash(binary),
                        "is_adult": spec.get("is_adult", False),
                        "is_source_homepage": spec.get("is_source_homepage", False),
                        "exists_in_latest_source": spec.get("present_in_latest_source", True),
                    },
                )

        for item in payload["figure_prototypes"]:
            media_key = item.get("main_image_id")
            if media_key:
                select_main_image(
                    prototypes[item["id"]].pk,
                    media_records[media_key].pk,
                    reason="Synthetic fixture explicitly selects this main image",
                    actor=reviewer,
                )

        config = payload["system_settings"]
        SystemSetting.objects.create(
            singleton_key=1,
            show_adult_images=config["show_adult_images"],
            page_size=config["gallery_page_size"],
            public_access_enabled=config["public_read_enabled"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                "seeded shared fixture: "
                f"works={len(works)} characters={len(characters)} manufacturers={len(manufacturers)} "
                f"prototypes={len(prototypes)} candidates={len(candidates)}"
            )
        )
