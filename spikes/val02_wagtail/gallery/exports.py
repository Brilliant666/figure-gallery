"""Framework-neutral JSON / relational CSV exports (never media binaries)."""

import csv
import json
from pathlib import Path

from .models import (
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


def _iso(value):
    return value.isoformat() if value else None


def build_export_bundle():
    return {
        "schema_version": 1,
        "export_format": "figure-gallery-open-relational",
        "contains_binary_media": False,
        "works": [
            {
                "id": item.pk,
                "name": item.name,
                "original_name": item.original_name,
                "aliases": item.aliases,
            }
            for item in Work.objects.order_by("pk")
        ],
        "characters": [
            {
                "id": item.pk,
                "display_name": item.display_name,
                "name_zh": item.name_zh,
                "name_ja": item.name_ja,
                "name_en": item.name_en,
                "aliases": item.aliases,
                "work_id": item.work_id,
                "is_hidden": item.is_hidden,
                "is_soft_deleted": item.is_soft_deleted,
            }
            for item in Character.objects.order_by("pk")
        ],
        "manufacturers": [
            {"id": item.pk, "name": item.name, "aliases": item.aliases, "status": item.status}
            for item in Manufacturer.objects.order_by("pk")
        ],
        "figure_prototypes": [
            {
                "id": item.pk,
                "title": item.title,
                "character_ids": [character.pk for character in item.characters.all()],
                "work_id": item.work_id,
                "manufacturer_id": item.manufacturer_id,
                "figure_type": item.figure_type,
                "scale": item.scale,
                "costume_skin_text": item.costume_skin_text,
                "is_multi_character": item.is_multi_character,
                "is_adult": item.is_adult,
                "live": item.live,
                "is_hidden": item.is_hidden,
                "is_soft_deleted": item.is_soft_deleted,
                "is_merged": item.is_merged,
                "merged_into_id": item.merged_into_id,
                "main_image_id": item.main_image_id,
                "created_at": _iso(item.created_at),
                "updated_at": _iso(item.updated_at),
            }
            for item in FigurePrototype.objects.prefetch_related("characters").order_by("pk")
        ],
        "figure_versions": [
            {
                "id": item.pk,
                "prototype_id": item.prototype_id,
                "name": item.name,
                "kind": item.kind,
                "notes": item.notes,
            }
            for item in FigureVersion.objects.order_by("pk")
        ],
        "source_records": [
            {
                "id": item.pk,
                "prototype_id": item.prototype_id,
                "source_type": item.source_type,
                "source_item_id": item.source_item_id,
                "source_url": item.source_url,
                "normalized_url": item.normalized_url,
                "source_status": item.source_status,
                "last_synced_at": _iso(item.last_synced_at),
                "is_unavailable": item.is_unavailable,
                "raw_snapshot": item.raw_snapshot,
            }
            for item in SourceRecord.objects.order_by("pk")
        ],
        "candidate_records": [
            {
                "id": item.pk,
                "source_id": item.source_id,
                "status": item.status,
                "raw_title": item.raw_title,
                "raw_character_names": item.raw_character_names,
                "raw_work_name": item.raw_work_name,
                "raw_manufacturer": item.raw_manufacturer,
                "raw_category": item.raw_category,
                "raw_scale": item.raw_scale,
                "raw_release_date": item.raw_release_date,
                "raw_snapshot": item.raw_snapshot,
                "field_decisions": item.field_decisions,
                "review_reason": item.review_reason,
                "target_prototype_id": item.target_prototype_id,
                "target_version_id": item.target_version_id,
            }
            for item in CandidateRecord.objects.order_by("pk")
        ],
        "candidate_images": [
            {
                "id": item.pk,
                "candidate_id": item.candidate_id,
                "prototype_id": item.prototype_id,
                "media_id": item.image_id,
                "original_url": item.original_url,
                "storage_key": item.storage_key,
                "file_size": item.file_size,
                "width": item.width,
                "height": item.height,
                "format": item.format,
                "sha256": item.sha256,
                "perceptual_hash": item.perceptual_hash,
                "is_adult": item.is_adult,
                "is_source_homepage": item.is_source_homepage,
                "exists_in_latest_source": item.exists_in_latest_source,
                "selected_as_main": item.selected_as_main,
            }
            for item in CandidateImage.objects.order_by("pk")
        ],
        "operation_logs": [
            {
                "id": item.pk,
                "actor_id": item.actor_id,
                "actor_label": item.actor_label,
                "created_at": _iso(item.created_at),
                "operation": item.operation,
                "reason": item.reason,
                "before_state": item.before_state,
                "after_state": item.after_state,
                "related_records": item.related_records,
                "is_undone": item.is_undone,
                "undo_of_id": item.undo_of_id,
            }
            for item in OperationLog.objects.order_by("pk")
        ],
        "system_settings": [
            {
                "id": item.pk,
                "show_adult_images": item.show_adult_images,
                "page_size": item.page_size,
                "public_access_enabled": item.public_access_enabled,
            }
            for item in SystemSetting.objects.order_by("pk")
        ],
    }


def write_json_export(path):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(build_export_bundle(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return [output]


def _csv_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return "" if value is None else value


def write_csv_export(directory):
    output = Path(directory)
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for table, rows in build_export_bundle().items():
        if not isinstance(rows, list):
            continue
        if not rows:
            continue
        destination = output / f"{table}.csv"
        with destination.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(
                {key: _csv_value(value) for key, value in row.items()} for row in rows
            )
        files.append(destination)
    manifest = output / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "contains_binary_media": False,
                "tables": [item.name for item in files],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    files.append(manifest)
    return files
