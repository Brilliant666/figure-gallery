"""Exercise the shared CandidateClient against a loopback Payload server."""

from __future__ import annotations

import copy
import json
import os
import re
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
    candidates = [copy.deepcopy(row) for row in fixture["candidate_records"] if row["id"] in wanted]
    if {row["id"] for row in candidates} != wanted:
        raise RuntimeError("shared fixture is missing the two live-smoke candidates")

    # The browser fixture may already have seeded the shared contract rows.
    # Give this real-HTTP client probe its own deterministic synthetic source
    # namespace so a seed record cannot be mistaken for another client's
    # candidate. Repeated calls inside this probe still use the same keys and
    # therefore exercise endpoint idempotency.
    namespace = os.environ.get("VAL02_PAYLOAD_LIVE_SMOKE_NAMESPACE", "val02b-live")
    if not re.fullmatch(r"[a-z0-9-]{3,48}", namespace):
        raise RuntimeError("VAL02_PAYLOAD_LIVE_SMOKE_NAMESPACE must be a safe synthetic label")
    for candidate in candidates:
        original_id = candidate["id"]
        safe_id = re.sub(r"[^a-z0-9-]+", "-", original_id.lower()).strip("-")
        candidate["id"] = f"{namespace}-{safe_id}"
        candidate["source"]["source_item_id"] = f"{namespace}-{safe_id}"
        candidate["source"]["source_url"] = f"https://{namespace}.invalid/source/{safe_id}"
        for index, image in enumerate(candidate.get("images", []), start=1):
            image_id = f"{namespace}-{safe_id}-{index}"
            image["id"] = image_id
            image["source_url"] = f"https://{namespace}.invalid/media/{image_id}.png"
            image["storage_key"] = f"candidate/{namespace}/{image_id}.png"

    wanted = {row["id"] for row in candidates}

    upload_candidate = next(row for row in candidates if row["id"].endswith("candidate-new-unmatched"))
    upload_image = copy.deepcopy(upload_candidate["images"][0])
    # Ensure the real multipart call, rather than metadata-only upsert, creates
    # the first media byte record.
    upload_candidate["images"] = []

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

    upload_index = next(index for index, row in enumerate(candidates) if row["id"] == upload_candidate["id"])
    first_upload = client.upload_candidate_image(
        candidate_id=str(first[upload_index]["candidate_id"]),
        client_candidate_id=upload_candidate["id"],
        image=upload_image,
        filename="first-loopback-name.png",
    )
    repeated_upload = client.upload_candidate_image(
        candidate_id=str(first[upload_index]["candidate_id"]),
        client_candidate_id=upload_candidate["id"],
        image=upload_image,
        filename="same-content-renamed.png",
    )
    if first_upload.get("created") is not True or repeated_upload.get("created") is not False:
        raise RuntimeError(f"multipart upload was not create-then-idempotent: {first_upload=} {repeated_upload=}")
    if first_upload.get("media_id") != repeated_upload.get("media_id"):
        raise RuntimeError("renaming identical upload changed the media identity")

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
                "multipart_created": [first_upload.get("created"), repeated_upload.get("created")],
                "multipart_media_stable": first_upload.get("media_id") == repeated_upload.get("media_id"),
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
