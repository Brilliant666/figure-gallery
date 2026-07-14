"""Load the shared VAL-02B negative-test catalog without performing requests."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ATTACK_CATALOG_PATH = Path(__file__).resolve().parent / "attack_cases.json"
EXPECTED_ATTACK_IDS = tuple(
    [f"AUTH-{index:02d}" for index in range(1, 9)]
    + [f"MEDIA-{index:02d}" for index in range(1, 4)]
    + [f"REVIEW-{index:02d}" for index in range(1, 4)]
    + [f"UNDO-{index:02d}" for index in range(1, 4)]
)


@dataclass(frozen=True)
class AttackCase:
    identifier: str
    category: str
    mapped_gate: str
    title: str
    request: str
    expected: str
    expected_error: str


def load_attack_cases(path: Path | str = ATTACK_CATALOG_PATH) -> tuple[AttackCase, ...]:
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if set(document) != {"schema_version", "catalog_id", "cases"}:
        raise ValueError("attack catalog has unexpected fields")
    if document["schema_version"] != 1 or document["catalog_id"] != "val02b-shared-attack-cases-v1":
        raise ValueError("attack catalog identity is invalid")
    if not isinstance(document["cases"], list):
        raise ValueError("attack catalog cases must be an array")
    cases: list[AttackCase] = []
    required = {
        "id",
        "category",
        "mapped_gate",
        "title",
        "request",
        "expected",
        "expected_error",
    }
    for raw in document["cases"]:
        if not isinstance(raw, dict) or set(raw) != required:
            raise ValueError("every attack case must contain only the canonical fields")
        if not all(isinstance(raw[field], str) and raw[field].strip() for field in required):
            raise ValueError("attack case values must be non-empty strings")
        if raw["expected"] != "reject":
            raise ValueError("shared attack cases must have a reject outcome")
        cases.append(
            AttackCase(
                identifier=raw["id"],
                category=raw["category"],
                mapped_gate=raw["mapped_gate"],
                title=raw["title"],
                request=raw["request"],
                expected=raw["expected"],
                expected_error=raw["expected_error"],
            )
        )
    identifiers = tuple(case.identifier for case in cases)
    if identifiers != EXPECTED_ATTACK_IDS:
        raise ValueError("attack cases must contain the canonical ordered IDs exactly once")
    if any(not case.mapped_gate.startswith("BG-") for case in cases):
        raise ValueError("every attack case must map to a BG gate")
    return tuple(cases)


def attack_case_map(path: Path | str = ATTACK_CATALOG_PATH) -> dict[str, AttackCase]:
    return {case.identifier: case for case in load_attack_cases(path)}


def safe_attack_manifest(path: Path | str = ATTACK_CATALOG_PATH) -> list[dict[str, Any]]:
    """Return portable case metadata; the catalog never contains credentials or payload bytes."""

    return [
        {
            "id": case.identifier,
            "category": case.category,
            "mapped_gate": case.mapped_gate,
            "expected": case.expected,
            "expected_error": case.expected_error,
        }
        for case in load_attack_cases(path)
    ]
