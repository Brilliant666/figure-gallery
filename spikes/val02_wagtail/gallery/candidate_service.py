"""Narrow candidate-only write boundary shared by HTTP and local tests."""

from copy import deepcopy
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.db import transaction
from django.utils import timezone

from .models import (
    CandidateImage,
    CandidateRecord,
    Character,
    Manufacturer,
    OperationLog,
    SourceRecord,
)


class CandidateIngressError(ValueError):
    pass


FORBIDDEN_FORMAL_FIELDS = {
    "character",
    "characters",
    "work",
    "manufacturer",
    "figure_prototype",
    "figure_version",
    "prototype",
    "version",
    "target_prototype",
    "target_version",
    "main_image",
    "main_image_id",
    "image",
    "image_id",
    "selected_as_main",
    "live",
}

TRACKING_QUERY_KEYS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}


def normalize_source_url(value):
    parsed = urlsplit(str(value).strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise CandidateIngressError("source_url must be an absolute HTTP(S) URL")
    host = parsed.hostname.lower()
    port = parsed.port
    netloc = host
    if port and not ((parsed.scheme.lower() == "http" and port == 80) or (parsed.scheme.lower() == "https" and port == 443)):
        netloc = f"{host}:{port}"
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS
    ]
    return urlunsplit((parsed.scheme.lower(), netloc, path, urlencode(sorted(query)), ""))


def _reject_forbidden_fields(payload):
    if not isinstance(payload, dict):
        raise CandidateIngressError("payload must be a JSON object")
    forbidden = FORBIDDEN_FORMAL_FIELDS.intersection(payload)
    if forbidden:
        raise CandidateIngressError(
            "candidate ingress cannot write formal fields: " + ", ".join(sorted(forbidden))
        )


def _find_unmatched_characters(names):
    unmatched = []
    records = list(Character.objects.filter(is_soft_deleted=False))
    for value in names:
        needle = str(value).strip().casefold()
        matched = any(
            needle
            in {
                item.display_name.casefold(),
                item.name_zh.casefold(),
                item.name_ja.casefold(),
                item.name_en.casefold(),
                *(str(alias).casefold() for alias in item.aliases),
            }
            for item in records
        )
        if not matched:
            unmatched.append(value)
    return unmatched


def _source_values(payload):
    source = payload.get("source", payload)
    if not isinstance(source, dict):
        raise CandidateIngressError("source must be an object")
    source_type = str(source.get("source_type", "")).strip().lower()
    source_item_id = str(source.get("source_item_id", "")).strip()
    source_url = str(source.get("source_url", "")).strip()
    if not source_type or not source_url:
        raise CandidateIngressError("source_type and source_url are required")
    return source, source_type, source_item_id, source_url, normalize_source_url(source_url)


@transaction.atomic
def upsert_candidate(payload, *, actor_label="candidate-api", owner=None):
    """Idempotently write SourceRecord/CandidateRecord and candidate media only.

    It deliberately has no code path to create formal Character, Manufacturer,
    FigurePrototype, FigureVersion, or to select a main image.
    """

    _reject_forbidden_fields(payload)
    source_input, source_type, source_item_id, source_url, normalized_url = _source_values(payload)
    candidate_input = payload.get("candidate", payload)
    _reject_forbidden_fields(candidate_input)

    source = None
    migrated_from_url_fallback = False
    if source_item_id:
        source = SourceRecord.objects.select_for_update().filter(
            source_type=source_type, source_item_id=source_item_id
        ).first()
        if source is None:
            source = SourceRecord.objects.select_for_update().filter(
                source_type=source_type,
                source_item_id="",
                normalized_url=normalized_url,
            ).first()
            migrated_from_url_fallback = source is not None
    else:
        source = SourceRecord.objects.select_for_update().filter(
            source_type=source_type,
            source_item_id="",
            normalized_url=normalized_url,
        ).first()

    source_created = source is None
    if source is None:
        source = SourceRecord(source_type=source_type)
    elif (
        source.prototype_id is not None
        and not CandidateRecord.objects.filter(source=source).exists()
    ):
        raise CandidateIngressError(
            "candidate ingress cannot claim a formal source without an existing candidate"
        )

    source_before = {
        "identity_key": None if source_created else source.identity_key,
        "source_url": "" if source_created else source.source_url,
        "raw_snapshot": {} if source_created else deepcopy(source.raw_snapshot),
    }
    source.source_item_id = source_item_id
    source.source_url = source_url
    source.normalized_url = normalized_url
    source.source_status = str(source_input.get("source_status", ""))
    source.last_synced_at = timezone.now()
    source.is_unavailable = bool(
        source_input.get("is_unavailable", source_input.get("is_stale", False))
    )
    source.raw_snapshot = deepcopy(source_input.get("raw_snapshot", payload.get("raw_snapshot", {})))
    # Intentionally never touch source.prototype from candidate ingress.
    source.save()

    defaults = {
        "raw_title": str(candidate_input.get("raw_title", "")).strip(),
        "raw_character_names": list(candidate_input.get("raw_character_names", [])),
        "raw_work_name": str(candidate_input.get("raw_work_name", "")),
        "raw_manufacturer": str(candidate_input.get("raw_manufacturer", "")),
        "raw_category": str(candidate_input.get("raw_category", "")),
        "raw_scale": str(candidate_input.get("raw_scale", "")),
        "raw_release_date": str(
            candidate_input.get("raw_release_date", candidate_input.get("raw_date", "")) or ""
        ),
        "raw_snapshot": deepcopy(candidate_input.get("raw_snapshot", {})),
    }
    if not defaults["raw_title"]:
        raise CandidateIngressError("candidate.raw_title is required")

    try:
        candidate = CandidateRecord.objects.select_for_update().get(source=source)
        candidate_created = False
    except CandidateRecord.DoesNotExist:
        candidate = CandidateRecord(source=source)
        candidate_created = True

    if owner is not None and candidate.owner_id not in {None, owner.pk}:
        raise CandidateIngressError("candidate belongs to another client")
    client_candidate_id = str(
        candidate_input.get("client_candidate_id") or candidate_input.get("id") or ""
    ).strip()
    if owner is not None and client_candidate_id:
        conflicting = CandidateRecord.objects.filter(
            owner=owner, client_candidate_id=client_candidate_id
        ).exclude(pk=candidate.pk if candidate.pk else None)
        if conflicting.exists():
            raise CandidateIngressError("client_candidate_id already belongs to another candidate")

    candidate_before = {}
    if not candidate_created:
        candidate_before = {
            field: deepcopy(getattr(candidate, field)) for field in defaults
        }
    ownership_changed = bool(
        owner is not None
        and (candidate.owner_id != owner.pk or (client_candidate_id and candidate.client_candidate_id != client_candidate_id))
    )
    changed = candidate_created or ownership_changed or any(
        candidate_before.get(field) != value for field, value in defaults.items()
    )
    for field, value in defaults.items():
        setattr(candidate, field, value)
    if owner is not None:
        candidate.owner = owner
    if client_candidate_id:
        candidate.client_candidate_id = client_candidate_id
    candidate.unmatched_character_names = _find_unmatched_characters(
        defaults["raw_character_names"]
    )
    raw_manufacturer = defaults["raw_manufacturer"].strip()
    candidate.unmatched_manufacturer_name = (
        raw_manufacturer
        if raw_manufacturer
        and not Manufacturer.objects.filter(name__iexact=raw_manufacturer).exists()
        else ""
    )
    if not candidate_created and changed and candidate.status in {
        CandidateRecord.Status.ACCEPTED,
        CandidateRecord.Status.MERGED,
    }:
        candidate.status = CandidateRecord.Status.UPDATE_PENDING
    candidate.save()

    image_ids = []
    image_changed = False
    protected_image_conflicts = []
    for image_payload in payload.get("candidate_images", payload.get("images", [])):
        _reject_forbidden_fields(image_payload)
        image_defaults = {
            "original_url": str(image_payload.get("source_url", image_payload.get("original_url", ""))),
            "file_size": int(image_payload.get("file_size") or 0),
            "width": int(image_payload.get("width", image_payload.get("generator", {}).get("width", 0)) or 0),
            "height": int(image_payload.get("height", image_payload.get("generator", {}).get("height", 0)) or 0),
            "format": str(image_payload.get("format", "PNG")),
            "sha256": str(image_payload.get("sha256", "")),
            "perceptual_hash": str(image_payload.get("perceptual_hash", "")),
            "is_adult": bool(image_payload.get("is_adult", False)),
            "is_source_homepage": bool(image_payload.get("is_source_homepage", False)),
            "exists_in_latest_source": bool(
                image_payload.get(
                    "exists_in_latest_source",
                    image_payload.get("present_in_latest_source", True),
                )
            ),
        }
        existing_image = (
            CandidateImage.objects.select_for_update()
            .filter(
                candidate=candidate,
                storage_key=str(image_payload.get("storage_key", "")),
            )
            .first()
        )
        if existing_image is not None and (
            existing_image.prototype_id is not None or existing_image.selected_as_main
        ):
            conflicting_fields = sorted(
                field
                for field, value in image_defaults.items()
                if getattr(existing_image, field) != value
            )
            if conflicting_fields:
                image_changed = True
                protected_image_conflicts.append(
                    {
                        "candidate_image_id": existing_image.pk,
                        "fields": conflicting_fields,
                    }
                )
            image_ids.append(existing_image.pk)
            # Once an image belongs to formal data (or is selected as main), candidate
            # ingress may report a changed observation but must never rewrite its
            # provenance, hash, local Wagtail Image, or formal ownership.
            continue
        if existing_image is None or any(
            getattr(existing_image, field) != value
            for field, value in image_defaults.items()
        ):
            image_changed = True
        image_record, _ = CandidateImage.objects.update_or_create(
            candidate=candidate,
            storage_key=str(image_payload.get("storage_key", "")),
            defaults=image_defaults,
        )
        image_ids.append(image_record.pk)

    changed = changed or image_changed
    if (
        not candidate_created
        and image_changed
        and candidate.status
        in {CandidateRecord.Status.ACCEPTED, CandidateRecord.Status.MERGED}
    ):
        candidate.status = CandidateRecord.Status.UPDATE_PENDING
        candidate.save(update_fields=["status", "updated_at"])
    outcome = "new" if candidate_created else ("updated" if changed else "unchanged")
    OperationLog.objects.create(
        actor_label=actor_label,
        operation=OperationLog.Operation.CANDIDATE_UPSERT,
        reason=f"candidate-only idempotent upsert: {outcome}",
        before_state={"source": source_before, "candidate": candidate_before},
        after_state={
            "source_identity": source.identity_key,
            "candidate_id": candidate.pk,
            "status": candidate.status,
            "outcome": outcome,
            "protected_image_conflicts": deepcopy(protected_image_conflicts),
        },
        related_records={
            "source_id": source.pk,
            "candidate_id": candidate.pk,
            "candidate_image_ids": image_ids,
            "migrated_from_url_fallback": migrated_from_url_fallback,
        },
        scope=f"candidate-client:{owner.client_id}" if owner is not None else "candidate-ingress",
    )
    requested_changes = candidate_input.get("requested_changes", {})
    rejected_fields = sorted(
        {
            key
            for key in requested_changes
            if key in {"main_image", "main_image_id", "prototype", "prototype_id", "version_id"}
        }
    )
    return {
        "outcome": outcome,
        "source_id": source.pk,
        "candidate_id": candidate.pk,
        "identity_key": source.identity_key,
        "migrated_from_url_fallback": migrated_from_url_fallback,
        "rejected_fields": rejected_fields,
        "protected_image_conflicts": protected_image_conflicts,
    }
