"""Synthetic candidate-file ingestion behind the candidate-only identity boundary."""

from hashlib import sha256
from io import BytesIO

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from PIL import Image as PILImage, UnidentifiedImageError
from wagtail.images import get_image_model
from wagtail.models import Collection

from .models import (
    CandidateImage,
    CandidateRecord,
    CandidateUploadReceipt,
    OperationLog,
)


MAX_CANDIDATE_IMAGE_BYTES = 64 * 1024
CONTENT_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg"}


def average_hash(binary):
    with PILImage.open(BytesIO(binary)) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        pixels = []
        for sample_y in range(8):
            y = min(height - 1, (sample_y * height) // 8)
            for sample_x in range(8):
                x = min(width - 1, (sample_x * width) // 8)
                red, green, blue = rgb.getpixel((x, y))
                pixels.append((299 * red + 587 * green + 114 * blue) // 1000)
    mean = sum(pixels) / len(pixels)
    bits = "".join("1" if value >= mean else "0" for value in pixels)
    return f"{int(bits, 2):016x}"


def inspect_candidate_image(binary):
    try:
        with PILImage.open(BytesIO(binary)) as image:
            image.verify()
        with PILImage.open(BytesIO(binary)) as image:
            file_format = image.format
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValidationError("Uploaded content is not a valid PNG or JPEG image.") from exc
    if file_format not in CONTENT_TYPES:
        raise ValidationError("Only PNG and JPEG candidate images are accepted.")
    return {
        "format": file_format,
        "content_type": CONTENT_TYPES[file_format],
        "width": width,
        "height": height,
        "file_size": len(binary),
        "sha256": sha256(binary).hexdigest(),
        "perceptual_hash": average_hash(binary),
    }


def _validate_metadata(metadata, observed):
    required = {
        "client_candidate_id",
        "idempotency_key",
        "filename",
        "content_type",
        "width",
        "height",
        "file_size",
        "sha256",
        "perceptual_hash",
    }
    missing = sorted(required.difference(metadata))
    if missing:
        raise ValidationError("Missing candidate image metadata: " + ", ".join(missing))
    expected = {
        "content_type": str(metadata["content_type"]).lower(),
        "width": int(metadata["width"]),
        "height": int(metadata["height"]),
        "file_size": int(metadata["file_size"]),
        "sha256": str(metadata["sha256"]).lower(),
        "perceptual_hash": str(metadata["perceptual_hash"]).lower(),
    }
    mismatches = [key for key, value in expected.items() if observed[key] != value]
    if mismatches:
        raise ValidationError(
            "Declared candidate image metadata does not match content: "
            + ", ".join(sorted(mismatches))
        )


def _candidate_collection():
    root = Collection.get_first_root_node()
    collection = root.get_children().filter(name="VAL-02B candidate uploads").first()
    return collection or root.add_child(name="VAL-02B candidate uploads")


def import_candidate_image(*, owner, metadata, uploaded_file):
    """Validate, content-address, deduplicate, rendition, and audit one upload."""

    if uploaded_file.size > MAX_CANDIDATE_IMAGE_BYTES:
        raise ValidationError("Candidate image exceeds the 64 KiB spike limit.")
    binary = uploaded_file.read(MAX_CANDIDATE_IMAGE_BYTES + 1)
    if len(binary) > MAX_CANDIDATE_IMAGE_BYTES:
        raise ValidationError("Candidate image exceeds the 64 KiB spike limit.")
    observed = inspect_candidate_image(binary)
    _validate_metadata(metadata, observed)
    request_content_type = str(getattr(uploaded_file, "content_type", "") or "").lower()
    if request_content_type != observed["content_type"]:
        raise ValidationError("Multipart content type does not match the uploaded image.")
    candidate_id = int(metadata.get("candidate_id") or 0)
    idempotency_key = str(metadata.get("idempotency_key") or "").strip()
    client_candidate_id = str(metadata.get("client_candidate_id") or "").strip()
    if not candidate_id or not idempotency_key or not client_candidate_id:
        raise ValidationError("Candidate ID, client candidate ID and idempotency key are required.")
    if not 16 <= len(idempotency_key) <= 200 or "\n" in idempotency_key or "\r" in idempotency_key:
        raise ValidationError("Idempotency key must contain 16 to 200 safe characters.")
    filename = str(metadata.get("filename") or "")
    if not filename or len(filename) > 255 or any(item in filename for item in ("\r", "\n", "/", "\\")):
        raise ValidationError("Candidate filename is absent, too long, or unsafe.")

    created_storage_entries = []
    try:
        with transaction.atomic():
            candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
            if candidate.owner_id != owner.pk:
                raise ValidationError("Candidate belongs to another client.")
            if candidate.client_candidate_id != client_candidate_id:
                raise ValidationError("Client candidate identity does not match the owner record.")
            prior_key = CandidateUploadReceipt.objects.select_for_update().filter(
                owner=owner, idempotency_key=idempotency_key
            ).first()
            if prior_key is not None:
                if prior_key.candidate_id != candidate.pk or prior_key.sha256 != observed["sha256"]:
                    raise ValidationError("Idempotency key was already used for different content.")
                return _media_result(prior_key.candidate_image, outcome="unchanged")
            prior_content = CandidateImage.objects.select_for_update().filter(
                candidate=candidate, sha256=observed["sha256"], image__isnull=False
            ).first()
            if prior_content is not None:
                record = prior_content
                media = record.image
            else:
                reusable = CandidateImage.objects.filter(
                    sha256=observed["sha256"], image__isnull=False
                ).select_related("image").first()
                media = reusable.image if reusable is not None else None
                if media is None:
                    extension = "png" if observed["format"] == "PNG" else "jpg"
                    media = get_image_model().objects.create(
                        title=f"candidate-{observed['sha256'][:16]}",
                        collection=_candidate_collection(),
                        file=ContentFile(
                            binary,
                            name=(
                                f"candidate-media/{observed['sha256'][:2]}/"
                                f"{observed['sha256']}.{extension}"
                            ),
                        ),
                    )
                    created_storage_entries.append((media.file.storage, media.file.name))
                record = CandidateImage.objects.create(
                    candidate=candidate,
                    image=media,
                    original_url="",
                    client_filename=filename,
                    content_type=observed["content_type"],
                    idempotency_key=idempotency_key,
                    storage_key=media.file.name,
                    file_size=observed["file_size"],
                    width=observed["width"],
                    height=observed["height"],
                    format=observed["format"],
                    sha256=observed["sha256"],
                    perceptual_hash=observed["perceptual_hash"],
                )

            CandidateUploadReceipt.objects.create(
                owner=owner,
                candidate=candidate,
                candidate_image=record,
                idempotency_key=idempotency_key,
                sha256=observed["sha256"],
            )
            operation = OperationLog.objects.create(
                actor_label=f"candidate-client:{owner.client_id}",
                operation=OperationLog.Operation.CANDIDATE_UPSERT,
                reason="candidate-only validated media upload",
                before_state={},
                after_state={
                    "candidate_image_id": record.pk,
                    "sha256": record.sha256,
                    "storage_key": record.storage_key,
                },
                related_records={
                    "candidate_id": candidate.pk,
                    "candidate_image_id": record.pk,
                    "client_id": owner.client_id,
                },
                scope=f"candidate-client:{owner.client_id}",
            )
            thumbnail_existed = media.renditions.filter(
                filter_spec="fill-64x64"
            ).exists()
            preview_existed = media.renditions.filter(
                filter_spec="max-320x320"
            ).exists()
            thumbnail = media.get_rendition("fill-64x64")
            preview = media.get_rendition("max-320x320")
            if not thumbnail_existed:
                created_storage_entries.append(
                    (thumbnail.file.storage, thumbnail.file.name)
                )
            if not preview_existed:
                created_storage_entries.append((preview.file.storage, preview.file.name))
            operation.related_records = {
                **operation.related_records,
                "thumbnail": thumbnail.file.name,
                "preview": preview.file.name,
            }
            operation.save(update_fields=["related_records"])
            return _media_result(
                record,
                outcome="new" if prior_content is None else "unchanged",
                thumbnail=thumbnail,
                preview=preview,
            )
    except Exception:
        # Django rolls database rows back; explicitly remove a just-created object because
        # storage backends are not transactional. Reused formal media is never deleted.
        for storage, storage_name in reversed(created_storage_entries):
            if storage_name and storage.exists(storage_name):
                storage.delete(storage_name)
        raise


def _media_result(record, *, outcome, thumbnail=None, preview=None):
    if thumbnail is None:
        thumbnail = record.image.get_rendition("fill-64x64")
    if preview is None:
        preview = record.image.get_rendition("max-320x320")
    return {
        "outcome": outcome,
        "candidate_image_id": record.pk,
        "media_id": record.image_id,
        "storage_key": record.storage_key,
        "sha256": record.sha256,
        "perceptual_hash": record.perceptual_hash,
        "thumbnail_key": thumbnail.file.name,
        "preview_key": preview.file.name,
    }
