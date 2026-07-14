"""Per-client candidate identity for the disposable Wagtail probe."""

from hashlib import sha256
from hmac import compare_digest
import secrets

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from .models import CandidateClientCredential, OperationLog


def hash_candidate_token(token):
    value = str(token or "")
    if not value:
        raise ValidationError("A non-empty candidate token is required.")
    return sha256(value.encode("utf-8")).hexdigest()


def _require_staff(actor):
    if actor is None or not actor.is_authenticated or not actor.is_staff:
        raise PermissionDenied("A staff user is required to manage candidate clients.")


@transaction.atomic
def create_candidate_client(*, client_id, reason, actor, token=None):
    """Create an attributable identity and return its bearer token exactly once."""

    _require_staff(actor)
    client_id = str(client_id or "").strip()
    reason = str(reason or "").strip()
    if not client_id or not reason:
        raise ValidationError("Client ID and audit reason are required.")
    plaintext = token or secrets.token_urlsafe(32)
    credential = CandidateClientCredential.objects.create(
        client_id=client_id,
        token_hash=hash_candidate_token(plaintext),
    )
    OperationLog.objects.create(
        actor=actor,
        actor_label=actor.get_username() or f"user:{actor.pk}",
        operation=OperationLog.Operation.CLIENT_IDENTITY,
        reason=reason,
        before_state={},
        after_state={"client_id": client_id, "status": credential.status},
        related_records={"action": "candidate_client_create", "client_id": client_id},
        scope=f"candidate-client:{client_id}",
    )
    return credential, plaintext


def authenticate_candidate_client(*, client_id, token):
    """Return an active identity without ever loading or comparing plaintext storage."""

    client_id = str(client_id or "").strip()
    token = str(token or "")
    if not client_id or not token:
        raise PermissionDenied("Candidate client credentials are required.")
    try:
        credential = CandidateClientCredential.objects.get(client_id=client_id)
    except CandidateClientCredential.DoesNotExist as exc:
        # Perform the same hash work for unknown IDs before returning a generic error.
        compare_digest(hash_candidate_token(token), "0" * 64)
        raise PermissionDenied("Invalid or revoked candidate client credentials.") from exc
    supplied = hash_candidate_token(token)
    if credential.status != CandidateClientCredential.Status.ACTIVE or not compare_digest(
        supplied, credential.token_hash
    ):
        raise PermissionDenied("Invalid or revoked candidate client credentials.")
    return credential


@transaction.atomic
def disable_candidate_client(client_id, *, reason, actor):
    _require_staff(actor)
    reason = str(reason or "").strip()
    if not reason:
        raise ValidationError("An audit reason is required.")
    credential = CandidateClientCredential.objects.select_for_update().get(
        client_id=client_id
    )
    before = {"status": credential.status, "disabled_at": None}
    credential.status = CandidateClientCredential.Status.DISABLED
    credential.disabled_at = timezone.now()
    credential.save(update_fields=["status", "disabled_at", "updated_at"])
    OperationLog.objects.create(
        actor=actor,
        actor_label=actor.get_username() or f"user:{actor.pk}",
        operation=OperationLog.Operation.CLIENT_IDENTITY,
        reason=reason,
        before_state=before,
        after_state={
            "status": credential.status,
            "disabled_at": credential.disabled_at.isoformat(),
        },
        related_records={
            "action": "candidate_client_disable",
            "client_id": credential.client_id,
        },
        scope=f"candidate-client:{credential.client_id}",
    )
    return credential


@transaction.atomic
def rotate_candidate_client_token(client_id, *, token, reason, actor):
    """Rotate a runtime-supplied token without retaining or returning plaintext."""

    _require_staff(actor)
    reason = str(reason or "").strip()
    if not reason:
        raise ValidationError("An audit reason is required.")
    credential = CandidateClientCredential.objects.select_for_update().get(
        client_id=client_id
    )
    before = {"status": credential.status, "token_hash_changed": False}
    credential.token_hash = hash_candidate_token(token)
    credential.status = CandidateClientCredential.Status.ACTIVE
    credential.disabled_at = None
    credential.save(
        update_fields=["token_hash", "status", "disabled_at", "updated_at"]
    )
    OperationLog.objects.create(
        actor=actor,
        actor_label=actor.get_username() or f"user:{actor.pk}",
        operation=OperationLog.Operation.CLIENT_IDENTITY,
        reason=reason,
        before_state=before,
        after_state={"status": credential.status, "token_hash_changed": True},
        related_records={
            "action": "candidate_client_rotate",
            "client_id": credential.client_id,
        },
        scope=f"candidate-client:{credential.client_id}",
    )
    return credential
