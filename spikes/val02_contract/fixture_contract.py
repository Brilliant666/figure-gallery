"""Load and validate the shared, fully synthetic VAL-02 fixture."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


CONTRACT_DIR = Path(__file__).resolve().parent
DEFAULT_FIXTURE_PATH = CONTRACT_DIR / "fixtures" / "domain_fixture.json"


class FixtureValidationError(ValueError):
    """Raised when the shared fixture does not satisfy the agreed scenarios."""


def load_fixture(path: Path | str = DEFAULT_FIXTURE_PATH) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fixture_sha256(path: Path | str = DEFAULT_FIXTURE_PATH) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _index(rows: Iterable[dict[str, Any]], name: str) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for row in rows:
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise FixtureValidationError(f"{name} contains an empty or non-string id")
        if identifier in indexed:
            raise FixtureValidationError(f"{name} contains duplicate id {identifier!r}")
        indexed[identifier] = row
    return indexed


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FixtureValidationError(message)


def _all_image_descriptors(fixture: dict[str, Any]) -> list[dict[str, Any]]:
    images = list(fixture["media"])
    for candidate in fixture["candidate_records"]:
        images.extend(candidate["images"])
    return images


def validate_fixture(
    fixture: dict[str, Any], fixture_directory: Path | None = None
) -> dict[str, int]:
    """Validate every scenario required by the shared VAL-02 fixture contract."""

    required_top_level = {
        "schema_version",
        "fixture_id",
        "synthetic_only",
        "media_policy",
        "works",
        "characters",
        "manufacturers",
        "media",
        "figure_prototypes",
        "figure_versions",
        "source_records",
        "candidate_records",
        "operation_logs",
        "system_settings",
        "scenarios",
    }
    missing = sorted(required_top_level - fixture.keys())
    _require(not missing, f"fixture is missing top-level fields: {missing}")
    _require(fixture["schema_version"] == 1, "schema_version must be 1")
    _require(fixture["fixture_id"] == "val02-synthetic-domain-v1", "unexpected fixture_id")
    _require(fixture["synthetic_only"] is True, "fixture must declare synthetic_only=true")
    policy = fixture["media_policy"]
    _require(policy["binary_committed"] is False, "fixture must not commit image binaries")
    _require(policy["generation"] == "dynamic_png", "fixture images must be generated dynamically")
    _require(policy["identity_field"] == "storage_key", "media identity must use storage_key")

    works = _index(fixture["works"], "works")
    characters = _index(fixture["characters"], "characters")
    manufacturers = _index(fixture["manufacturers"], "manufacturers")
    media = _index(fixture["media"], "media")
    prototypes = _index(fixture["figure_prototypes"], "figure_prototypes")
    versions = _index(fixture["figure_versions"], "figure_versions")
    sources = _index(fixture["source_records"], "source_records")
    candidates = _index(fixture["candidate_records"], "candidate_records")
    _index(fixture["operation_logs"], "operation_logs")

    _require(len(works) == 2, "fixture must contain exactly two works")
    _require(len(characters) >= 4, "fixture must contain at least four characters")
    _require(len(manufacturers) == 3, "fixture must contain exactly three manufacturers")
    _require(len(prototypes) == 5, "fixture must contain exactly five figure prototypes")
    _require(len(candidates) >= 2, "fixture must contain multiple candidates")

    same_name = [row for row in characters.values() if row["display_name"] == "林"]
    _require(len(same_name) == 2, "fixture must contain two same-name characters")
    _require(len({row["work_id"] for row in same_name}) == 2, "same-name characters must belong to different works")
    for character in characters.values():
        _require(character["work_id"] in works, f"unknown work on {character['id']}")
        _require(isinstance(character["aliases"], list) and character["aliases"], f"{character['id']} needs aliases")

    draft_manufacturers = [row for row in manufacturers.values() if row["status"] == "draft"]
    _require(len(draft_manufacturers) == 1, "fixture must contain exactly one draft manufacturer")
    allowed_manufacturer_states = {"draft", "active", "hidden"}
    _require(
        all(row["status"] in allowed_manufacturer_states for row in manufacturers.values()),
        "manufacturer contains an unsupported state",
    )

    for prototype in prototypes.values():
        _require(prototype["work_id"] in works, f"unknown work on {prototype['id']}")
        _require(prototype["manufacturer_id"] in manufacturers, f"unknown manufacturer on {prototype['id']}")
        _require(manufacturers[prototype["manufacturer_id"]]["status"] != "draft", "draft manufacturer used by formal prototype")
        _require(prototype["figure_type"] in {"scale", "prize"}, f"unsupported type on {prototype['id']}")
        _require(bool(prototype["character_ids"]), f"{prototype['id']} needs at least one character")
        _require(all(item in characters for item in prototype["character_ids"]), f"unknown character on {prototype['id']}")
        main_id = prototype["main_image_id"]
        if main_id is not None:
            _require(main_id in media, f"unknown main image {main_id}")
            _require(media[main_id]["manually_selected_as_main"] is True, "main image must be manually selected")
            _require(media[main_id]["owner_id"] == prototype["id"], "main image owner mismatch")
    adult_with_safe_main = [
        prototype
        for prototype in prototypes.values()
        if prototype["is_adult"]
        and prototype["main_image_id"]
        and media[prototype["main_image_id"]]["is_adult"] is False
    ]
    _require(adult_with_safe_main, "fixture needs an adult prototype with a non-adult main image")

    scenarios = fixture["scenarios"]
    similar_ids = scenarios["similar_pose_distinct_prototype_ids"]
    _require(len(similar_ids) == 2 and len(set(similar_ids)) == 2, "similar pose scenario needs two distinct ids")
    _require(all(item in prototypes for item in similar_ids), "similar pose scenario references unknown prototype")
    _require(
        len({prototypes[item]["manufacturer_id"] for item in similar_ids}) == 2,
        "similar pose prototypes must use different manufacturers",
    )
    group = prototypes[scenarios["group_prototype_id"]]
    _require(group["is_group"] is True and len(group["character_ids"]) > 1, "group scenario is invalid")

    for version in versions.values():
        _require(version["prototype_id"] in prototypes, f"unknown prototype on {version['id']}")
    variant_id = scenarios["multi_version_prototype_id"]
    variant_kinds = {row["kind"] for row in versions.values() if row["prototype_id"] == variant_id}
    _require(
        {"standard", "deluxe", "reissue", "recolor"}.issubset(variant_kinds),
        "multi-version scenario lacks a required version kind",
    )

    source_identity: set[tuple[str, str]] = set()
    stale_source_found = False
    for source in sources.values():
        _require(source["prototype_id"] in prototypes, f"unknown prototype on {source['id']}")
        if source["source_item_id"]:
            identity = (source["source_type"], source["source_item_id"])
            _require(identity not in source_identity, f"duplicate stable source identity {identity}")
            source_identity.add(identity)
        if source["is_stale"]:
            prototype = prototypes[source["prototype_id"]]
            stale_source_found = stale_source_found or (
                prototype["publication_status"] == "published"
                and prototype["main_image_id"] is not None
                and media[prototype["main_image_id"]]["storage_key"]
            )
    _require(stale_source_found, "fixture needs a stale source whose formal prototype remains published")
    _require(
        scenarios["stale_source_published_prototype_id"] in prototypes,
        "stale source scenario references an unknown prototype",
    )

    adult_image_found = False
    for candidate in candidates.values():
        _require(len(candidate["images"]) >= 2, f"{candidate['id']} must have multiple images")
        _index(candidate["images"], f"candidate {candidate['id']} images")
        adult_image_found = adult_image_found or any(image["is_adult"] for image in candidate["images"])
        if candidate["status"] in {"deferred", "ignored"}:
            _require(bool(candidate["reason"]), f"{candidate['id']} must preserve a reason")
        source = candidate["source"]
        _require(source["source_type"], f"{candidate['id']} needs source_type")
        _require(source["source_item_id"] or source["source_url"], f"{candidate['id']} needs source identity")
    _require(adult_image_found, "fixture needs at least one adult candidate image")

    protected_prototype = prototypes[scenarios["protected_main_image_prototype_id"]]
    protected_candidate = candidates[scenarios["protected_main_image_candidate_id"]]
    _require(protected_prototype["main_image_id"], "protected scenario needs an existing main image")
    requested_main = protected_candidate["requested_changes"].get("main_image_id")
    _require(bool(requested_main), "protected scenario must attempt to change main_image_id")
    _require("main_image_id" in protected_candidate["expected_rejections"], "main image change must be expected to fail")
    _require(requested_main != protected_prototype["main_image_id"], "candidate must attempt a different main image")

    fallback = scenarios["url_fallback_migration"]
    _require(fallback["later_source_item_id"], "fallback migration needs a later stable id")
    _require(urlsplit(fallback["initial_url"]).hostname == "synthetic.invalid", "fallback scenario must be synthetic")
    _require(fallback["initial_url"] != fallback["canonical_url"], "fallback scenario must exercise URL normalization")

    all_images = _all_image_descriptors(fixture)
    image_ids = [image["id"] for image in all_images]
    _require(len(image_ids) == len(set(image_ids)), "image ids must be globally unique")
    storage_keys = [image["storage_key"] for image in all_images]
    _require(len(storage_keys) == len(set(storage_keys)), "storage keys must be globally unique")
    for image in all_images:
        generator = image["generator"]
        _require(image["format"] == "PNG", f"{image['id']} must use dynamic PNG")
        _require(1 <= generator["width"] <= 256 and 1 <= generator["height"] <= 256, f"{image['id']} dimensions out of bounds")
        _require(len(generator["rgba"]) == 4 and all(0 <= channel <= 255 for channel in generator["rgba"]), f"{image['id']} has invalid RGBA")
        _require(urlsplit(image["source_url"]).hostname == "synthetic.invalid", f"{image['id']} has a non-synthetic URL")

    settings = fixture["system_settings"]
    _require(settings["show_adult_images"] is False, "adult images must default to hidden")
    _require(settings["gallery_page_size"] == 16, "default gallery page size must be 16")

    if fixture_directory is not None:
        binary_suffixes = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"}
        committed = [path for path in Path(fixture_directory).rglob("*") if path.is_file() and path.suffix.lower() in binary_suffixes]
        _require(not committed, f"fixture directory contains committed image binaries: {committed}")

    return {
        "works": len(works),
        "characters": len(characters),
        "manufacturers": len(manufacturers),
        "figure_prototypes": len(prototypes),
        "figure_versions": len(versions),
        "source_records": len(sources),
        "candidate_records": len(candidates),
        "image_descriptors": len(all_images),
    }


if __name__ == "__main__":
    summary = validate_fixture(load_fixture(), DEFAULT_FIXTURE_PATH.parent)
    print(json.dumps({"ok": True, "fixture_sha256": fixture_sha256(), "counts": summary}, ensure_ascii=False, indent=2))
