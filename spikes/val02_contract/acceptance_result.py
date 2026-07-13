"""Helpers for prototype test runners to generate, never hand-author, results."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from .fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256
except ImportError:  # direct script execution
    from fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256


CONTRACT_PATH = Path(__file__).resolve().parent / "acceptance_contract.json"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def acceptance_ids() -> tuple[str, ...]:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    return tuple(item["id"] for item in contract["items"])


def source_file_manifest(paths: Iterable[Path | str]) -> tuple[str, ...]:
    references: list[str] = []
    for raw_path in paths:
        path = Path(raw_path).resolve()
        if not path.is_file():
            raise ValueError(f"source evidence file does not exist: {path}")
        try:
            reference = path.relative_to(REPOSITORY_ROOT).as_posix()
        except ValueError as exc:
            raise ValueError(f"source evidence must be inside the repository: {path}") from exc
        references.append(reference)
    if not references:
        raise ValueError("at least one implementation/test source file is required")
    if len(references) != len(set(references)):
        raise ValueError("source evidence files must be unique")
    return tuple(sorted(references))


def digest_source_files(paths: Iterable[Path | str]) -> str:
    digest = hashlib.sha256()
    references = source_file_manifest(paths)
    for reference in references:
        path = REPOSITORY_ROOT / reference
        digest.update(reference.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


@dataclass
class AcceptanceRecorder:
    """Collect test observations and emit the canonical result shape."""

    prototype: str
    runner: str
    command: str
    source_digest: str
    source_files: tuple[str, ...]
    fixture_path: Path = DEFAULT_FIXTURE_PATH
    runtime: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    exports: dict[str, Any] | None = None
    security: dict[str, Any] | None = None
    _assertions: dict[str, dict[str, Any]] = field(default_factory=dict, init=False)

    @classmethod
    def from_source_files(
        cls,
        *,
        prototype: str,
        runner: str,
        command: str,
        source_files: Iterable[Path | str],
        fixture_path: Path = DEFAULT_FIXTURE_PATH,
        **metadata: Any,
    ) -> "AcceptanceRecorder":
        source_paths = tuple(source_files)
        return cls(
            prototype=prototype,
            runner=runner,
            command=command,
            source_digest=digest_source_files(source_paths),
            source_files=source_file_manifest(source_paths),
            fixture_path=fixture_path,
            **metadata,
        )

    def record(self, identifier: str, status: str, *, kind: str, reference: str, observed: str) -> None:
        if identifier not in acceptance_ids():
            raise ValueError(f"unknown acceptance id: {identifier}")
        if identifier in self._assertions:
            raise ValueError(f"acceptance id already recorded: {identifier}")
        if status not in {"pass", "fail", "not_run"}:
            raise ValueError(f"unsupported status: {status}")
        if not all(isinstance(value, str) and value.strip() for value in (kind, reference, observed)):
            raise ValueError("evidence kind, reference, and observed must be non-empty strings")
        self._assertions[identifier] = {
            "id": identifier,
            "status": status,
            "evidence": [{"kind": kind, "reference": reference, "observed": observed}],
        }

    def add_evidence(self, identifier: str, *, kind: str, reference: str, observed: str) -> None:
        if identifier not in self._assertions:
            raise ValueError(f"record an acceptance status before adding evidence: {identifier}")
        if not all(isinstance(value, str) and value.strip() for value in (kind, reference, observed)):
            raise ValueError("evidence kind, reference, and observed must be non-empty strings")
        self._assertions[identifier]["evidence"].append(
            {"kind": kind, "reference": reference, "observed": observed}
        )

    def as_document(self) -> dict[str, Any]:
        expected = acceptance_ids()
        missing = [identifier for identifier in expected if identifier not in self._assertions]
        if missing:
            raise ValueError(f"cannot generate incomplete result; missing {missing}")
        document: dict[str, Any] = {
            "schema_version": 1,
            "contract_id": "val02-acceptance-v1",
            "prototype": self.prototype,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "generated_by": {
                "runner": self.runner,
                "command": self.command,
                "source_digest": self.source_digest,
                "source_files": list(self.source_files),
            },
            "fixture_sha256": fixture_sha256(self.fixture_path),
            "assertions": [self._assertions[identifier] for identifier in expected],
        }
        for name in ("runtime", "metrics", "exports", "security"):
            value = getattr(self, name)
            if value is not None:
                document[name] = value
        return document

    def write(self, path: Path | str) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(self.as_document(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return output
