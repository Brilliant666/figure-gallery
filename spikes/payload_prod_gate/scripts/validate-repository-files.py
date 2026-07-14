#!/usr/bin/env python3
"""Parse tracked JSON/CSV and validate local Markdown link targets.

This is deliberately network-free: external URLs and in-document anchors are
reported as out of scope, while repository-relative links must resolve to an
existing tracked file or directory.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


INLINE_LINK = re.compile(r"!?\[[^\]]*\]\((?P<target><[^>]+>|[^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
REFERENCE_LINK = re.compile(r"^\s*\[[^\]]+\]:\s*(?P<target><[^>]+>|\S+)", re.MULTILINE)
EXTERNAL_SCHEMES = {"data", "ftp", "http", "https", "mailto"}


def tracked_paths(root: pathlib.Path) -> list[pathlib.Path]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [root / value.decode("utf-8") for value in completed.stdout.split(b"\0") if value]


def markdown_targets(text: str) -> list[str]:
    return [
        match.group("target").strip("<>")
        for pattern in (INLINE_LINK, REFERENCE_LINK)
        for match in pattern.finditer(text)
    ]


def validate_markdown_link(root: pathlib.Path, source: pathlib.Path, raw_target: str) -> bool:
    target = unquote(raw_target.replace("\\", "/"))
    parsed = urlsplit(target)
    if parsed.scheme.lower() in EXTERNAL_SCHEMES or parsed.netloc or not parsed.path:
        return False
    candidate = root / parsed.path.lstrip("/") if parsed.path.startswith("/") else source.parent / parsed.path
    resolved_root = root.resolve()
    resolved = candidate.resolve()
    try:
        resolved.relative_to(resolved_root)
    except ValueError as error:
        raise AssertionError(f"{source.relative_to(root)} links outside the repository: {raw_target}") from error
    if not resolved.exists():
        raise AssertionError(f"{source.relative_to(root)} has a missing local link: {raw_target}")
    return True


def main() -> int:
    root = pathlib.Path(
        subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode("utf-8").strip()
    )
    paths = tracked_paths(root)
    json_count = csv_count = markdown_count = local_link_count = 0
    for path in paths:
        suffix = path.suffix.lower()
        if suffix == ".json":
            json.loads(path.read_text(encoding="utf-8"))
            json_count += 1
        elif suffix == ".csv":
            with path.open("r", encoding="utf-8", newline="") as stream:
                list(csv.reader(stream, strict=True))
            csv_count += 1
        elif suffix in {".md", ".markdown"}:
            text = path.read_text(encoding="utf-8")
            markdown_count += 1
            for target in markdown_targets(text):
                local_link_count += int(validate_markdown_link(root, path, target))
    print(
        f"repository-file-validation pass: json={json_count} csv={csv_count} "
        f"markdown={markdown_count} local_links={local_link_count}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, csv.Error, json.JSONDecodeError, UnicodeError) as error:
        print(f"repository-file-validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
