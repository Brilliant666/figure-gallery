from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit


SOURCE_NAMES = (
    "Solaris Japan",
    "Good Smile Company",
    "Good Smile Company (legacy catalog)",
    "Japan Figure",
)


def text(record: dict) -> str:
    values = [
        record.get("title", ""),
        record.get("category", ""),
        *(record.get("source_tags") or []),
    ]
    return " ".join(str(value) for value in values).lower()


def is_prize(record: dict) -> bool:
    category = str(record.get("category", "")).lower()
    tags = {str(value).lower() for value in record.get("source_tags") or []}
    title = str(record.get("title", "")).lower()
    return (
        category == "prize"
        or "prize" in tags
        or "meta-type-prize" in tags
        or "meta-figure-prize" in tags
        or "game-prize" in title
    )


def is_scale(record: dict) -> bool:
    category = str(record.get("category", "")).strip().casefold()
    return (
        bool(record.get("scale"))
        or bool(re.search(r"\b1\s*/\s*\d+\b", str(record.get("title", ""))))
        or ("scale" in category and "non-scale" not in category)
    )


def is_pop_up_parade(record: dict) -> bool:
    return "pop up parade" in text(record)


def is_limited(record: dict) -> bool:
    value = text(record)
    return "limited" in value or "exclusive" in value


def primary_type(record: dict) -> str:
    # Product class and release/channel modifiers are separate. POP UP PARADE
    # is kept distinct because the review asks for it explicitly.
    if is_prize(record):
        return "prize"
    if is_scale(record):
        return "scale"
    if is_pop_up_parade(record):
        return "pop_up_parade"
    if str(record.get("category", "")).strip().casefold() == "non-scale figure":
        return "static_non_scale"
    return "other_collector_retained_unclassified"


def normalize_manufacturer(value: str) -> str:
    key = re.sub(r"\s+", " ", (value or "").strip()).casefold()
    aliases = {
        "kadokawa corporation": "KADOKAWA",
        "kadokawa": "KADOKAWA",
        "bandai spirits": "Bandai Spirits / Banpresto",
        "bandai spirits.": "Bandai Spirits / Banpresto",
        "banpresto": "Bandai Spirits / Banpresto",
        "sega ltd": "SEGA",
        "sega": "SEGA",
        "sega fave": "SEGA",
        "good smile arts shanghai": "Good Smile family",
        "good smile company": "Good Smile family",
        "f:nex": "FuRyu",
        "furyu": "FuRyu",
        "freeing": "FREEing",
    }
    if key in aliases:
        return aliases[key]
    return value.strip() or "<missing>"


def source_families(record: dict) -> set[str]:
    return {str(value) for value in record.get("sources") or [] if value}


def image_origin(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.netloc.casefold()
    path = parsed.path.casefold()
    if host in {"www.goodsmile.com", "images.goodsmile.info"}:
        return "good_smile"
    if host == "cdn.shopify.com" and "/s/files/1/0318/2649/" in path:
        return "solaris"
    if host == "cdn.shopify.com" and "/s/files/1/0568/2298/8958/" in path:
        return "japan_figure"
    return "unattributed"


def field_completeness(items: list[dict], fields: tuple[str, ...]) -> dict[str, int]:
    return {
        field: sum(record.get(field) not in (None, "", []) for record in items)
        for field in fields
    }


def audit(payload: dict) -> dict:
    items = payload.get("items") or []
    if payload.get("count") != len(items):
        raise ValueError("declared count does not match items")
    ids = [record.get("id") for record in items]
    if len(set(ids)) != len(ids):
        raise ValueError("item IDs are not unique")

    memberships = Counter()
    combinations = Counter()
    for record in items:
        families = tuple(sorted(source_families(record)))
        combinations[families] += 1
        memberships.update(families)

    unique_by_source = {
        source: sum(source_families(record) == {source} for record in items)
        for source in SOURCE_NAMES
    }
    good_smile_names = {
        "Good Smile Company",
        "Good Smile Company (legacy catalog)",
    }
    source_rollup = {
        "solaris": sum("Solaris Japan" in source_families(record) for record in items),
        "goodSmileCurrentOrLegacy": sum(
            bool(source_families(record) & good_smile_names) for record in items
        ),
        "japanFigure": sum("Japan Figure" in source_families(record) for record in items),
        "crossSourceItems": sum(len(source_families(record)) > 1 for record in items),
        "singleSourceItems": sum(len(source_families(record)) == 1 for record in items),
    }

    image_counts = [len(record.get("image_urls") or []) for record in items]
    image_hosts = Counter(
        urlsplit(url).netloc.lower()
        for record in items
        for url in record.get("image_urls") or []
    )
    image_urls = [url for record in items for url in record.get("image_urls") or []]
    image_origins = Counter(image_origin(url) for url in image_urls)
    records_by_image_origin = Counter()
    for record in items:
        origins = {image_origin(url) for url in record.get("image_urls") or []}
        records_by_image_origin.update(origins)

    primary_types = Counter(primary_type(record) for record in items)
    flags = {
        "prize": sum(is_prize(record) for record in items),
        "scaleEvidence": sum(is_scale(record) for record in items),
        "popUpParade": sum(is_pop_up_parade(record) for record in items),
        "limitedOrExclusive": sum(is_limited(record) for record in items),
    }

    manufacturers_raw = Counter(record.get("manufacturer") or "<missing>" for record in items)
    manufacturers_normalized = Counter(
        normalize_manufacturer(record.get("manufacturer") or "") for record in items
    )

    final_good_smile = [
        record
        for record in items
        if str(record.get("source", "")).startswith("Good Smile Company")
    ]
    provenance_mix = {
        "goodSmileLabeledRecords": len(final_good_smile),
        "withSolarisOnlyFields": sum(
            record.get("source_price") not in (None, "")
            or record.get("published_at") not in (None, "")
            or record.get("source_updated_at") not in (None, "")
            for record in final_good_smile
        ),
        "withJapanFigureOnlySku": sum(
            record.get("source_sku") not in (None, "") for record in final_good_smile
        ),
        "withGenericSourceProductId": sum(
            record.get("source_product_id") not in (None, "")
            for record in final_good_smile
        ),
        "exactImageAttributionRecoverable": False,
        "reason": (
            "merge_records flattens source fields and image URLs. Known hosts/store "
            "prefixes support aggregate image attribution, but the record no longer "
            "stores field-level or image-level SourceRecord relationships."
        ),
    }

    metadata_fields = (
        "title",
        "manufacturer",
        "category",
        "scale",
        "height_mm",
        "release",
        "price_jpy",
        "source_price",
        "sculptor",
        "source_product_id",
        "source_sku",
        "published_at",
    )

    return {
        "schemaVersion": 1,
        "dataset": {
            "generatedAt": payload.get("generated_at"),
            "declaredCount": payload.get("count"),
            "actualCount": len(items),
            "uniqueIds": len(set(ids)),
        },
        "types": {
            "methodology": (
                "Mutually exclusive review buckets use prize first, then explicit "
                "scale evidence, POP UP PARADE, explicit Non-Scale Figure, and the "
                "remaining collector-retained records. Limited/exclusive is an overlapping "
                "release/channel modifier."
            ),
            "primaryBuckets": dict(sorted(primary_types.items())),
            "overlappingFlags": flags,
        },
        "manufacturers": {
            "rawTop15": manufacturers_raw.most_common(15),
            "normalizedTop15": manufacturers_normalized.most_common(15),
        },
        "sources": {
            "memberships": dict(sorted(memberships.items())),
            "rollup": source_rollup,
            "uniqueByExactSource": unique_by_source,
            "combinations": [
                {"sources": list(sources), "items": count}
                for sources, count in combinations.most_common()
            ],
        },
        "images": {
            "withPrimary": sum(bool(record.get("image_url")) for record in items),
            "withAtLeast1": sum(count >= 1 for count in image_counts),
            "withAtLeast2": sum(count >= 2 for count in image_counts),
            "withAtLeast4": sum(count >= 4 for count in image_counts),
            "withAtLeast8": sum(count >= 8 for count in image_counts),
            "urlReferences": len(image_urls),
            "uniqueUrlStrings": len(set(image_urls)),
            "hosts": dict(image_hosts.most_common()),
            "attributedByHostOrStorePrefix": {
                "urlReferences": dict(sorted(image_origins.items())),
                "records": dict(sorted(records_by_image_origin.items())),
                "caveat": (
                    "Attribution uses Good Smile hosts and known Shopify store "
                    "prefixes. It does not recover per-field provenance from merged records."
                ),
            },
        },
        "metadataCompleteness": field_completeness(items, metadata_fields),
        "provenanceMix": provenance_mix,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--figures", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.figures.read_text(encoding="utf-8"))
    result = audit(payload)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
