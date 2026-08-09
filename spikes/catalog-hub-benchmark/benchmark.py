"""Offline calculator for the disposable Catalog Hub research benchmark."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _audit_metrics(audit: dict[str, Any]) -> dict[str, Any]:
    records = audit["records"]
    image_sample = audit["imageSample"]
    in_scope = [row for row in records if row["scope"] == "in"]
    matched_groups = {
        row["prototypeGroup"] for row in records if row["fgMatch"] != "none"
    }
    in_scope_groups = {row["prototypeGroup"] for row in in_scope}
    all_groups = {row["prototypeGroup"] for row in records}
    return {
        "sourceRecords": len(records),
        "currentRecords": sum(row["catalog"] == "current" for row in records),
        "legacyRecords": sum(row["catalog"] == "legacy" for row in records),
        "inScopeRecords": len(in_scope),
        "outOfScopeRecords": sum(row["scope"] == "out" for row in records),
        "ambiguousRecords": sum(row["scope"] == "ambiguous" for row in records),
        "probableUniquePrototypesAll": len(all_groups),
        "probableUniquePrototypesInScope": len(in_scope_groups),
        "intersectionPrototypes": len(matched_groups),
        "marginalPrototypeCandidates": len(in_scope_groups - matched_groups),
        "explicitRereleases": sum(bool(row["explicitRerelease"]) for row in records),
        "sampleImages": len(image_sample),
        "sampleHttpSuccess": sum(row["httpStatus"] == 200 for row in image_sample),
        "sampleHashPrefixesUnique": len({row["sha256Prefix"] for row in image_sample}),
        "sampleFullFigureImages": sum(bool(row["fullFigure"]) for row in image_sample),
    }


def build_results(
    observations: dict[str, Any], audit: dict[str, Any] | None = None
) -> dict[str, Any]:
    good_smile = dict(observations["goodSmile"])
    coverage = dict(good_smile["coverage"])
    media = dict(good_smile["media"])
    seeds = dict(good_smile["seedDependency"])

    audit_metrics = _audit_metrics(audit) if audit is not None else None
    if audit_metrics is not None:
        for field in (
            "sourceRecords",
            "inScopeRecords",
            "outOfScopeRecords",
            "ambiguousRecords",
            "probableUniquePrototypesAll",
            "probableUniquePrototypesInScope",
            "intersectionPrototypes",
            "marginalPrototypeCandidates",
        ):
            _require(
                coverage[field] == audit_metrics[field],
                f"Good Smile {field} disagrees with the per-record audit",
            )
        _require(
            good_smile["recordsByPrimaryCatalog"]["current"]
            == audit_metrics["currentRecords"]
            and good_smile["recordsByPrimaryCatalog"]["legacy"]
            == audit_metrics["legacyRecords"],
            "current/legacy counts disagree with the per-record audit",
        )
        _require(
            coverage["explicitReleaseEventsMin"]
            == coverage["sourceRecords"] + audit_metrics["explicitRereleases"],
            "explicit release-event lower bound is inconsistent",
        )
        _require(
            media["sample"]["downloadedImages"] == audit_metrics["sampleImages"]
            and media["sample"]["httpSuccess"] == audit_metrics["sampleHttpSuccess"]
            and media["sample"]["sha256Unique"]
            == audit_metrics["sampleHashPrefixesUnique"]
            and media["sample"]["fullFigureImages"]
            == audit_metrics["sampleFullFigureImages"],
            "image-sample aggregate disagrees with the per-image audit",
        )

    _require(
        coverage["inScopeRecords"]
        + coverage["outOfScopeRecords"]
        + coverage["ambiguousRecords"]
        == coverage["sourceRecords"],
        "Good Smile scope counts must sum to sourceRecords",
    )
    _require(
        coverage["existingFgPrototypes"]
        + coverage["probableUniquePrototypesInScope"]
        - coverage["intersectionPrototypes"]
        == coverage["unionPrototypes"],
        "prototype union arithmetic is inconsistent",
    )
    _require(
        coverage["probableUniquePrototypesInScope"]
        - coverage["intersectionPrototypes"]
        == coverage["marginalPrototypeCandidates"],
        "marginal prototype arithmetic is inconsistent",
    )
    _require(
        seeds["configuredSeeds"] + seeds["nonDirectSeedRecords"]
        == coverage["sourceRecords"],
        "seed counts must cover all Good Smile records",
    )

    coverage["directSeedFraction"] = round(
        seeds["configuredSeeds"] / coverage["sourceRecords"], 4
    )
    media["meanUrlsPerRecord"] = round(
        media["candidateImageUrls"] / coverage["sourceRecords"], 2
    )
    media["sampleFullFigureRate"] = round(
        media["sample"]["fullFigureImages"] / media["sample"]["downloadedImages"],
        4,
    )
    good_smile["coverage"] = coverage
    good_smile["media"] = media

    live_benchmarks = []
    for source in observations["liveBenchmarks"]:
        row = dict(source)
        requests = row["requests"]
        marginal = row.get("marginalCandidates")
        row["marginalCandidatesPerRequest"] = (
            round(marginal / requests, 4)
            if isinstance(marginal, int) and requests > 0
            else None
        )
        if row["status"] not in {"completed", "completed_limited"}:
            _require(
                row.get("rawProducts") is None,
                f"{row['source']} must not claim rawProducts when blocked",
            )
        live_benchmarks.append(row)

    return {
        "schemaVersion": observations["schemaVersion"],
        "task": observations["task"],
        "generatedAt": observations["generatedAt"],
        "baseline": observations["baseline"],
        "safety": observations["safety"],
        "auditEvidence": observations["auditEvidence"],
        "goodSmile": good_smile,
        "hubLandscape": observations["hubLandscape"],
        "liveBenchmarks": live_benchmarks,
        "economics": observations["economics"],
        "decision": observations["decision"],
        "limitations": observations["limitations"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--audit", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    observations = json.loads(args.input.read_text(encoding="utf-8"))
    audit = json.loads(args.audit.read_text(encoding="utf-8"))
    results = build_results(observations, audit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
