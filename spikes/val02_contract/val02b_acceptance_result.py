"""Generate VAL-02B gate results from executable prototype runners."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from .acceptance_result import digest_source_files, source_file_manifest
    from .fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256
except ImportError:  # direct script execution
    from acceptance_result import digest_source_files, source_file_manifest
    from fixture_contract import DEFAULT_FIXTURE_PATH, fixture_sha256


VAL02B_CONTRACT_PATH = Path(__file__).resolve().parent / "val02b_acceptance_contract.json"
VAL02B_CONTRACT_ID = "val02b-acceptance-v1"
VAL02B_PROTOTYPES = frozenset({"wagtail", "payload"})
VAL02B_STATUS_VALUES = frozenset({"pass", "fail", "not_run", "environment_blocked"})


def val02b_acceptance_ids() -> tuple[str, ...]:
    contract = json.loads(VAL02B_CONTRACT_PATH.read_text(encoding="utf-8"))
    return tuple(item["id"] for item in contract["items"])


@dataclass
class Val02bAcceptanceRecorder:
    """Collect one evidence-bearing result for each BG gate."""

    prototype: str
    runner: str
    command: str
    source_digest: str
    source_files: tuple[str, ...]
    fixture_path: Path = DEFAULT_FIXTURE_PATH
    runtime: dict[str, Any] | None = None
    environment: dict[str, Any] | None = None
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
    ) -> "Val02bAcceptanceRecorder":
        if prototype not in VAL02B_PROTOTYPES:
            raise ValueError(f"unsupported VAL-02B prototype: {prototype!r}")
        if not isinstance(runner, str) or not runner.strip() or runner.strip().lower() == "manual":
            raise ValueError("runner must identify an executable non-manual runner")
        if not isinstance(command, str) or not command.strip():
            raise ValueError("command must identify the executable generator command")
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

    def record(
        self,
        identifier: str,
        status: str,
        *,
        kind: str,
        reference: str,
        observed: str,
    ) -> None:
        if identifier not in val02b_acceptance_ids():
            raise ValueError(f"unknown VAL-02B gate id: {identifier}")
        if identifier in self._assertions:
            raise ValueError(f"VAL-02B gate already recorded: {identifier}")
        if status not in VAL02B_STATUS_VALUES:
            raise ValueError(f"unsupported VAL-02B status: {status}")
        if not all(isinstance(value, str) and value.strip() for value in (kind, reference, observed)):
            raise ValueError("evidence kind, reference, and observed must be non-empty strings")
        self._assertions[identifier] = {
            "id": identifier,
            "status": status,
            "evidence": [{"kind": kind, "reference": reference, "observed": observed}],
        }

    def add_evidence(
        self,
        identifier: str,
        *,
        kind: str,
        reference: str,
        observed: str,
    ) -> None:
        if identifier not in self._assertions:
            raise ValueError(f"record a VAL-02B gate before adding evidence: {identifier}")
        if not all(isinstance(value, str) and value.strip() for value in (kind, reference, observed)):
            raise ValueError("evidence kind, reference, and observed must be non-empty strings")
        self._assertions[identifier]["evidence"].append(
            {"kind": kind, "reference": reference, "observed": observed}
        )

    def as_document(self) -> dict[str, Any]:
        expected = val02b_acceptance_ids()
        missing = [identifier for identifier in expected if identifier not in self._assertions]
        if missing:
            raise ValueError(f"cannot generate incomplete VAL-02B result; missing {missing}")
        document: dict[str, Any] = {
            "schema_version": 1,
            "contract_id": VAL02B_CONTRACT_ID,
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
        for name in ("runtime", "environment", "metrics", "exports", "security"):
            value = getattr(self, name)
            if value is not None:
                document[name] = value
        return document

    def write(self, path: Path | str) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(self.as_document(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return output
