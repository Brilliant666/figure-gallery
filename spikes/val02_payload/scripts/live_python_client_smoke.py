"""Exercise the shared CandidateClient against a loopback Payload server."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_ROOT))

from spikes.val02_contract.fixture_contract import load_fixture  # noqa: E402
from spikes.val02_contract.python_candidate_client.client import (  # noqa: E402
    CandidateClient,
    CandidateClientError,
)


def main() -> int:
    fixture = load_fixture()
    wanted = {"candidate-new-unmatched", "candidate-main-image-attack"}
    candidates = [row for row in fixture["candidate_records"] if row["id"] in wanted]
    if {row["id"] for row in candidates} != wanted:
        raise RuntimeError("shared fixture is missing the two live-smoke candidates")

    client = CandidateClient.from_environment("payload")
    first = client.upsert_candidates(candidates)
    repeated = client.upsert_candidates(candidates)
    first_created = [bool(row.get("created")) for row in first]
    repeat_created = [bool(row.get("created")) for row in repeated]
    if first_created != [True, True] or repeat_created != [False, False]:
        raise RuntimeError(
            f"expected first create then idempotent repeat, got {first_created=} {repeat_created=}"
        )
    identity_fields = ("candidate_id", "source_id", "media_ids")
    if [tuple(row.get(key) if key != "media_ids" else tuple(row.get(key, [])) for key in identity_fields) for row in first] != [
        tuple(row.get(key) if key != "media_ids" else tuple(row.get(key, [])) for key in identity_fields)
        for row in repeated
    ]:
        raise RuntimeError("repeat upsert changed candidate/source/media identities")

    attack = copy.deepcopy(candidates[0])
    attack["id"] = "candidate-formal-field-attack"
    attack["main_image_id"] = 1
    attack_rejected = False
    try:
        client.upsert_candidate(attack)
    except CandidateClientError as exc:
        attack_rejected = "HTTP 403" in str(exc)
    if not attack_rejected:
        raise RuntimeError("formal/main-image attack was not rejected with HTTP 403")

    print(
        json.dumps(
            {
                "adapter": client.adapter_name,
                "attack_http_403": attack_rejected,
                "candidate_ids": sorted(wanted),
                "first_created": first_created,
                "repeat_created": repeat_created,
                "status": "passed",
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
