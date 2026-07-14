"""Audited, transactional human-only domain operations for the spike."""

from copy import deepcopy

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from .models import (
    CandidateImage,
    CandidateRecord,
    Character,
    FigurePrototype,
    FigureVersion,
    Manufacturer,
    OperationLog,
    ReviewWorkItem,
    SourceRecord,
    SystemSetting,
    Work,
)


def _require_reviewer(actor):
    if actor is None or not actor.is_authenticated or not actor.is_staff:
        raise PermissionDenied("A staff reviewer is required for formal-data operations.")


def _actor_label(actor):
    return actor.get_username() or f"user:{actor.pk}"


def _prototype_snapshot(prototype):
    return {
        "id": prototype.pk,
        "title": prototype.title,
        "live": prototype.live,
        "is_hidden": prototype.is_hidden,
        "is_soft_deleted": prototype.is_soft_deleted,
        "is_merged": prototype.is_merged,
        "merged_into_id": prototype.merged_into_id,
        "main_image_id": prototype.main_image_id,
        "domain_version": prototype.domain_version,
        "character_ids": [item.pk for item in prototype.characters.all()],
        "version_ids": list(prototype.versions.values_list("pk", flat=True)),
        "source_ids": list(prototype.sources.values_list("pk", flat=True)),
        "candidate_ids": list(prototype.candidates.values_list("pk", flat=True)),
        "candidate_image_ids": list(
            prototype.candidate_images.values_list("pk", flat=True)
        ),
    }


def _audit(
    *, actor, operation, reason, before, after, related, scope="gallery", scope_version=1
):
    return OperationLog.objects.create(
        actor=actor,
        actor_label=_actor_label(actor),
        operation=operation,
        reason=reason,
        before_state=deepcopy(before),
        after_state=deepcopy(after),
        related_records=deepcopy(related),
        scope=scope,
        scope_version=scope_version,
    )


def _required_reason(reason):
    value = str(reason or "").strip()
    if not value:
        raise ValidationError("An audit reason is required.")
    return value


def _manufacturer_snapshot(manufacturer):
    return {
        "id": manufacturer.pk,
        "name": manufacturer.name,
        "aliases": deepcopy(manufacturer.aliases),
        "status": manufacturer.status,
    }


def _settings_snapshot(config):
    return {
        "id": config.pk,
        "show_adult_images": config.show_adult_images,
        "page_size": config.page_size,
        "public_access_enabled": config.public_access_enabled,
    }


@transaction.atomic
def create_manufacturer(*, name, aliases=(), reason, actor):
    """Create a manufacturer in draft through the audited staff-only boundary."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    manufacturer = Manufacturer(
        name=str(name).strip(),
        aliases=[str(alias) for alias in aliases],
        # Deliberately not caller-controlled: new manufacturers always start draft.
        status=Manufacturer.Status.DRAFT,
    )
    manufacturer.full_clean()
    manufacturer.save()
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before={},
        after=_manufacturer_snapshot(manufacturer),
        related={
            "action": "manufacturer_create_draft",
            "manufacturer_id": manufacturer.pk,
        },
    )
    return manufacturer


@transaction.atomic
def set_manufacturer_status(manufacturer_id, *, status, reason, actor):
    """Activate, hide, or return a manufacturer to draft with an audit record."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    if status not in Manufacturer.Status.values:
        raise ValidationError("Unsupported manufacturer status.")
    manufacturer = Manufacturer.objects.select_for_update().get(pk=manufacturer_id)
    before = _manufacturer_snapshot(manufacturer)
    manufacturer.status = status
    manufacturer.full_clean()
    manufacturer.save(update_fields=["status", "updated_at"])
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=_manufacturer_snapshot(manufacturer),
        related={
            "action": "manufacturer_status",
            "manufacturer_id": manufacturer.pk,
        },
    )
    return manufacturer


_UNSET = object()


@transaction.atomic
def update_system_settings(
    *,
    reason,
    actor,
    show_adult_images=_UNSET,
    page_size=_UNSET,
    public_access_enabled=_UNSET,
):
    """Update the three public-gallery switches through one audited transaction."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    requested = {
        "show_adult_images": show_adult_images,
        "page_size": page_size,
        "public_access_enabled": public_access_enabled,
    }
    changes = {field: value for field, value in requested.items() if value is not _UNSET}
    if not changes:
        raise ValidationError("At least one system setting must be supplied.")
    config, _ = SystemSetting.objects.select_for_update().get_or_create(singleton_key=1)
    before = _settings_snapshot(config)
    for field, value in changes.items():
        setattr(config, field, value)
    config.full_clean()
    config.save(update_fields=list(changes))
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=_settings_snapshot(config),
        related={"action": "system_settings", "system_setting_id": config.pk},
    )
    return config


@transaction.atomic
def maintain_work(
    *, name, reason, actor, work_id=None, original_name="", aliases=()
):
    """Create or update a Work through the audited formal-data boundary."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    work = (
        Work.objects.select_for_update().get(pk=work_id)
        if work_id is not None
        else Work()
    )
    before = (
        {
            "id": work.pk,
            "name": work.name,
            "original_name": work.original_name,
            "aliases": deepcopy(work.aliases),
        }
        if work.pk
        else {}
    )
    work.name = str(name or "").strip()
    work.original_name = str(original_name or "").strip()
    work.aliases = [str(item).strip() for item in aliases if str(item).strip()]
    work.full_clean()
    work.save()
    after = {
        "id": work.pk,
        "name": work.name,
        "original_name": work.original_name,
        "aliases": deepcopy(work.aliases),
    }
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=after,
        related={"action": "work_maintain", "work_id": work.pk},
        scope=f"work:{work.pk}",
    )
    return work


@transaction.atomic
def maintain_character(
    *,
    display_name,
    reason,
    actor,
    character_id=None,
    work=None,
    aliases=(),
    name_zh="",
    name_ja="",
    name_en="",
    is_hidden=False,
    is_soft_deleted=False,
):
    """Create or update character aliases/status with one audit record."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    character = (
        Character.objects.select_for_update().get(pk=character_id)
        if character_id is not None
        else Character()
    )
    before = (
        {
            "id": character.pk,
            "display_name": character.display_name,
            "work_id": character.work_id,
            "aliases": deepcopy(character.aliases),
            "is_hidden": character.is_hidden,
            "is_soft_deleted": character.is_soft_deleted,
        }
        if character.pk
        else {}
    )
    character.display_name = str(display_name or "").strip()
    character.name_zh = str(name_zh or "").strip()
    character.name_ja = str(name_ja or "").strip()
    character.name_en = str(name_en or "").strip()
    character.aliases = [str(item).strip() for item in aliases if str(item).strip()]
    character.work = work
    character.is_hidden = bool(is_hidden)
    character.is_soft_deleted = bool(is_soft_deleted)
    character.full_clean()
    character.save()
    after = {
        "id": character.pk,
        "display_name": character.display_name,
        "work_id": character.work_id,
        "aliases": deepcopy(character.aliases),
        "is_hidden": character.is_hidden,
        "is_soft_deleted": character.is_soft_deleted,
    }
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=after,
        related={"action": "character_maintain", "character_id": character.pk},
        scope=f"character:{character.pk}",
    )
    return character


@transaction.atomic
def maintain_figure_version(
    *, prototype_id, name, kind, reason, actor, version_id=None, notes=""
):
    """Create or update one version without allowing generic model saves."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    prototype = FigurePrototype.objects.select_for_update().get(pk=prototype_id)
    version = (
        FigureVersion.objects.select_for_update().get(pk=version_id)
        if version_id is not None
        else FigureVersion()
    )
    before = (
        {
            "id": version.pk,
            "prototype_id": version.prototype_id,
            "name": version.name,
            "kind": version.kind,
            "notes": version.notes,
        }
        if version.pk
        else {}
    )
    version.prototype = prototype
    version.name = str(name or "").strip()
    version.kind = kind
    version.notes = str(notes or "")
    version.full_clean()
    version.save()
    prototype.domain_version += 1
    prototype.save(update_fields=["domain_version"])
    after = {
        "id": version.pk,
        "prototype_id": version.prototype_id,
        "name": version.name,
        "kind": version.kind,
        "notes": version.notes,
    }
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=after,
        related={"action": "figure_version_maintain", "version_id": version.pk},
        scope=f"prototype:{prototype.pk}",
        scope_version=prototype.domain_version,
    )
    return version


@transaction.atomic
def maintain_prototype_metadata(
    prototype_id,
    *,
    expected_version,
    reason,
    actor,
    title=None,
    live=None,
):
    """Minimal optimistic-lock formal prototype maintenance service."""

    _require_reviewer(actor)
    reason = _required_reason(reason)
    prototype = FigurePrototype.objects.select_for_update().get(pk=prototype_id)
    if prototype.domain_version != expected_version:
        raise ValidationError("Prototype version conflict.")
    before = _prototype_snapshot(prototype)
    changed = []
    if title is not None:
        prototype.title = str(title).strip()
        changed.append("title")
    if live is not None:
        prototype.live = bool(live)
        changed.append("live")
    if not changed:
        raise ValidationError("At least one prototype field must be supplied.")
    prototype.domain_version += 1
    changed.append("domain_version")
    prototype.full_clean()
    prototype.save(update_fields=changed)
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=_prototype_snapshot(prototype),
        related={"action": "prototype_maintain", "prototype_id": prototype.pk},
        scope=f"prototype:{prototype.pk}",
        scope_version=prototype.domain_version,
    )
    return prototype


@transaction.atomic
def review_candidate_status(candidate_id, *, status, reason, actor):
    _require_reviewer(actor)
    allowed = {
        CandidateRecord.Status.DEFERRED,
        CandidateRecord.Status.IGNORED,
        CandidateRecord.Status.ACCEPTED,
    }
    if status not in allowed:
        raise ValidationError("Unsupported manual review status.")
    reason = str(reason or "").strip()
    if status in {
        CandidateRecord.Status.DEFERRED,
        CandidateRecord.Status.IGNORED,
    } and not reason:
        raise ValidationError("Deferred and ignored candidates require a reason.")
    candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
    before = {"status": candidate.status, "reason": candidate.review_reason}
    candidate.status = status
    candidate.review_reason = reason
    candidate.save(update_fields=["status", "review_reason", "updated_at"])
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after={"status": candidate.status, "reason": candidate.review_reason},
        related={"candidate_id": candidate.pk},
    )
    return candidate


@transaction.atomic
def decide_candidate_field(
    candidate_id,
    *,
    field_name,
    accept,
    reason,
    actor,
    target_prototype_id=None,
):
    _require_reviewer(actor)
    candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
    allowed = {
        "title": ("raw_title", "title"),
        "scale": ("raw_scale", "scale"),
        "figure_type": ("raw_category", "figure_type"),
    }
    if field_name not in allowed:
        raise ValidationError("Only explicitly mapped candidate fields can be reviewed.")
    before = {
        "field_decisions": deepcopy(candidate.field_decisions),
        "target_prototype_id": candidate.target_prototype_id,
    }
    if target_prototype_id is not None:
        candidate.target_prototype = FigurePrototype.objects.select_for_update().get(
            pk=target_prototype_id
        )
    decisions = deepcopy(candidate.field_decisions)
    decisions[field_name] = {"decision": "accept" if accept else "reject", "reason": reason}
    candidate.field_decisions = decisions
    if accept:
        if candidate.target_prototype_id is None:
            raise ValidationError("An accepted field needs an explicit formal target.")
        raw_field, formal_field = allowed[field_name]
        prototype = FigurePrototype.objects.select_for_update().get(
            pk=candidate.target_prototype_id
        )
        value = getattr(candidate, raw_field)
        if formal_field == "figure_type":
            normalized = str(value).strip().lower()
            if normalized not in FigurePrototype.FigureType.values:
                raise ValidationError("Candidate category is not a supported formal type.")
            value = normalized
        setattr(prototype, formal_field, value)
        prototype.full_clean()
        prototype.save(update_fields=[formal_field])
    candidate.save(
        update_fields=["field_decisions", "target_prototype", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after={
            "field_decisions": decisions,
            "target_prototype_id": candidate.target_prototype_id,
        },
        related={"candidate_id": candidate.pk, "field": field_name, "accepted": accept},
    )
    return candidate


@transaction.atomic
def create_prototype_from_candidate(
    candidate_id,
    *,
    title,
    manufacturer,
    characters,
    work=None,
    figure_type=FigurePrototype.FigureType.SCALE,
    scale="",
    main_candidate_image=None,
    reason,
    actor,
):
    _require_reviewer(actor)
    candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
    prototype = FigurePrototype.objects.create(
        title=title,
        manufacturer=manufacturer,
        work=work,
        figure_type=figure_type,
        scale=scale,
        live=False,
        has_unpublished_changes=True,
    )
    prototype.characters.set(characters)
    prototype.save()
    version = FigureVersion.objects.create(
        prototype=prototype, name="Standard", kind=FigureVersion.Kind.STANDARD
    )
    candidate.target_prototype = prototype
    candidate.target_version = version
    candidate.status = CandidateRecord.Status.ACCEPTED
    candidate.review_reason = reason
    candidate.save()
    candidate.source.prototype = prototype
    candidate.source.save(update_fields=["prototype", "updated_at"])
    CandidateImage.objects.filter(candidate=candidate).update(prototype=prototype)
    if main_candidate_image is not None:
        select_main_image(
            prototype.pk,
            main_candidate_image.pk,
            reason=f"{reason} / manual initial main image",
            actor=actor,
        )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before={"candidate_status": CandidateRecord.Status.PENDING},
        after=_prototype_snapshot(prototype),
        related={
            "candidate_id": candidate.pk,
            "prototype_id": prototype.pk,
            "version_id": version.pk,
        },
    )
    return prototype


@transaction.atomic
def attach_candidate_to_version(candidate_id, version_id, *, reason, actor):
    _require_reviewer(actor)
    candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
    version = FigureVersion.objects.select_for_update().get(pk=version_id)
    before = {
        "target_prototype_id": candidate.target_prototype_id,
        "target_version_id": candidate.target_version_id,
        "status": candidate.status,
    }
    candidate.target_prototype = version.prototype
    candidate.target_version = version
    candidate.status = CandidateRecord.Status.MERGED
    candidate.review_reason = reason
    candidate.save()
    candidate.source.prototype = version.prototype
    candidate.source.save(update_fields=["prototype", "updated_at"])
    CandidateImage.objects.filter(candidate=candidate).update(prototype=version.prototype)
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after={
            "target_prototype_id": version.prototype_id,
            "target_version_id": version.pk,
            "status": candidate.status,
        },
        related={"candidate_id": candidate.pk, "version_id": version.pk},
    )
    return candidate


@transaction.atomic
def select_main_image(
    prototype_id,
    candidate_image_id,
    *,
    reason,
    actor,
    attach_if_unassigned=False,
):
    _require_reviewer(actor)
    prototype = FigurePrototype.objects.select_for_update().get(pk=prototype_id)
    candidate_image = CandidateImage.objects.select_for_update().get(
        pk=candidate_image_id
    )
    if candidate_image.prototype_id != prototype.pk:
        if not attach_if_unassigned or candidate_image.prototype_id is not None:
            raise ValidationError("The candidate image is not attached to this prototype.")
    if candidate_image.image_id is None:
        raise ValidationError("Local media must exist before it can be selected as main.")
    before = {
        "main_image_id": prototype.main_image_id,
        "candidate_image_prototype_id": candidate_image.prototype_id,
    }
    if candidate_image.prototype_id is None:
        candidate_image.prototype = prototype
        candidate_image.save(update_fields=["prototype", "updated_at"])
    CandidateImage.objects.filter(prototype=prototype, selected_as_main=True).update(
        selected_as_main=False
    )
    candidate_image.selected_as_main = True
    candidate_image.save(update_fields=["selected_as_main", "updated_at"])
    prototype.main_image = candidate_image.image
    prototype.save(update_fields=["main_image"])
    _audit(
        actor=actor,
        operation=OperationLog.Operation.MAIN_IMAGE,
        reason=reason,
        before=before,
        after={
            "main_image_id": prototype.main_image_id,
            "candidate_image_prototype_id": candidate_image.prototype_id,
        },
        related={"prototype_id": prototype.pk, "candidate_image_id": candidate_image.pk},
    )
    return prototype


def _locked_open_work_item(work_item_id, *, actor, expected_version):
    _require_reviewer(actor)
    work_item = ReviewWorkItem.objects.select_for_update().get(pk=work_item_id)
    if work_item.status != ReviewWorkItem.Status.OPEN:
        raise ValidationError("Completed review work items must be explicitly reopened.")
    if work_item.lock_version != expected_version:
        raise ValidationError(
            f"Review work item conflict: expected version {expected_version}, "
            f"current version {work_item.lock_version}."
        )
    return work_item


@transaction.atomic
def create_review_work_item(candidate_id, *, allowed_target_ids, reason, actor):
    _require_reviewer(actor)
    reason = _required_reason(reason)
    candidate = CandidateRecord.objects.select_for_update().get(pk=candidate_id)
    target_ids = list(dict.fromkeys(int(item) for item in allowed_target_ids))
    targets = list(
        FigurePrototype.objects.select_for_update().filter(
            pk__in=target_ids, is_soft_deleted=False, is_merged=False
        )
    )
    if {item.pk for item in targets} != set(target_ids):
        raise ValidationError("Every allowed review target must be an active prototype.")
    work_item = ReviewWorkItem.objects.create(
        candidate=candidate,
        reviewer=actor,
        started_at=timezone.now(),
    )
    work_item.allowed_targets.set(targets)
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={},
        after={
            "status": work_item.status,
            "lock_version": work_item.lock_version,
            "allowed_target_ids": target_ids,
        },
        related={
            "action": "review_work_item_create",
            "work_item_id": work_item.pk,
            "candidate_id": candidate.pk,
        },
    )
    return work_item


@transaction.atomic
def decide_review_work_item_field(
    work_item_id,
    *,
    expected_version,
    field_name,
    accept,
    reason,
    actor,
    target_prototype_id=None,
):
    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    if target_prototype_id is not None and not work_item.allowed_targets.filter(
        pk=target_prototype_id
    ).exists():
        raise PermissionDenied("The selected formal target is outside this review work item.")
    candidate = decide_candidate_field(
        work_item.candidate_id,
        field_name=field_name,
        accept=accept,
        reason=reason,
        actor=actor,
        target_prototype_id=target_prototype_id,
    )
    work_item.lock_version += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=["lock_version", "decision_reason", "reviewer", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={"lock_version": expected_version},
        after={"lock_version": work_item.lock_version},
        related={
            "action": "review_work_item_field_decision",
            "work_item_id": work_item.pk,
            "candidate_id": candidate.pk,
            "target_prototype_id": target_prototype_id,
        },
    )
    return work_item


@transaction.atomic
def complete_review_work_item(work_item_id, *, expected_version, reason, actor):
    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    before = {"status": work_item.status, "lock_version": work_item.lock_version}
    work_item.status = ReviewWorkItem.Status.COMPLETED
    work_item.lock_version += 1
    work_item.completed_at = timezone.now()
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=[
            "status",
            "lock_version",
            "completed_at",
            "decision_reason",
            "reviewer",
            "updated_at",
        ]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before=before,
        after={"status": work_item.status, "lock_version": work_item.lock_version},
        related={"action": "review_work_item_complete", "work_item_id": work_item.pk},
    )
    return work_item


@transaction.atomic
def review_work_item_status(
    work_item_id, *, expected_version, status, reason, actor
):
    """Record defer/ignore through the same optimistic-lock review boundary."""

    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    review_candidate_status(
        work_item.candidate_id,
        status=status,
        reason=reason,
        actor=actor,
    )
    work_item.lock_version += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=["lock_version", "decision_reason", "reviewer", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={"lock_version": expected_version},
        after={"lock_version": work_item.lock_version, "candidate_status": status},
        related={
            "action": "review_work_item_status",
            "work_item_id": work_item.pk,
            "candidate_id": work_item.candidate_id,
        },
    )
    return work_item


@transaction.atomic
def create_prototype_from_review_work_item(
    work_item_id,
    *,
    expected_version,
    title,
    manufacturer,
    characters,
    work=None,
    figure_type=FigurePrototype.FigureType.SCALE,
    scale="",
    main_candidate_image=None,
    reason,
    actor,
):
    """Explicitly create and authorize a new formal target for one work item."""

    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    prototype = create_prototype_from_candidate(
        work_item.candidate_id,
        title=title,
        manufacturer=manufacturer,
        characters=characters,
        work=work,
        figure_type=figure_type,
        scale=scale,
        main_candidate_image=main_candidate_image,
        reason=reason,
        actor=actor,
    )
    work_item.allowed_targets.add(prototype)
    work_item.lock_version += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=["lock_version", "decision_reason", "reviewer", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={"lock_version": expected_version},
        after={
            "lock_version": work_item.lock_version,
            "created_target_id": prototype.pk,
        },
        related={
            "action": "review_work_item_create_target",
            "work_item_id": work_item.pk,
            "prototype_id": prototype.pk,
        },
    )
    return work_item, prototype


@transaction.atomic
def attach_review_work_item_to_version(
    work_item_id, *, expected_version, version_id, reason, actor
):
    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    version = FigureVersion.objects.select_for_update().get(pk=version_id)
    if not work_item.allowed_targets.filter(pk=version.prototype_id).exists():
        raise PermissionDenied("The selected version is outside this review work item.")
    attach_candidate_to_version(
        work_item.candidate_id,
        version.pk,
        reason=reason,
        actor=actor,
    )
    work_item.lock_version += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=["lock_version", "decision_reason", "reviewer", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={"lock_version": expected_version},
        after={"lock_version": work_item.lock_version, "version_id": version.pk},
        related={
            "action": "review_work_item_attach_version",
            "work_item_id": work_item.pk,
            "prototype_id": version.prototype_id,
        },
    )
    return work_item


@transaction.atomic
def select_review_work_item_main_image(
    work_item_id,
    *,
    expected_version,
    prototype_id,
    candidate_image_id,
    reason,
    actor,
):
    reason = _required_reason(reason)
    work_item = _locked_open_work_item(
        work_item_id, actor=actor, expected_version=expected_version
    )
    if not work_item.allowed_targets.filter(pk=prototype_id).exists():
        raise PermissionDenied("The selected main-image target is outside this work item.")
    image = CandidateImage.objects.select_for_update().get(pk=candidate_image_id)
    if image.candidate_id != work_item.candidate_id:
        raise PermissionDenied("The selected image is outside this review work item.")
    select_main_image(
        prototype_id,
        image.pk,
        reason=reason,
        actor=actor,
        attach_if_unassigned=True,
    )
    work_item.lock_version += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=["lock_version", "decision_reason", "reviewer", "updated_at"]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before={"lock_version": expected_version},
        after={
            "lock_version": work_item.lock_version,
            "prototype_id": prototype_id,
            "candidate_image_id": image.pk,
        },
        related={
            "action": "review_work_item_main_image",
            "work_item_id": work_item.pk,
            "prototype_id": prototype_id,
        },
    )
    return work_item


@transaction.atomic
def reopen_review_work_item(work_item_id, *, reason, actor):
    _require_reviewer(actor)
    reason = _required_reason(reason)
    work_item = ReviewWorkItem.objects.select_for_update().get(pk=work_item_id)
    if work_item.status != ReviewWorkItem.Status.COMPLETED:
        raise ValidationError("Only a completed review work item can be reopened.")
    before = {"status": work_item.status, "lock_version": work_item.lock_version}
    work_item.status = ReviewWorkItem.Status.OPEN
    work_item.lock_version += 1
    work_item.completed_at = None
    work_item.reopen_count += 1
    work_item.decision_reason = reason
    work_item.reviewer = actor
    work_item.save(
        update_fields=[
            "status",
            "lock_version",
            "completed_at",
            "reopen_count",
            "decision_reason",
            "reviewer",
            "updated_at",
        ]
    )
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW_WORK,
        reason=reason,
        before=before,
        after={
            "status": work_item.status,
            "lock_version": work_item.lock_version,
            "reopen_count": work_item.reopen_count,
        },
        related={"action": "review_work_item_reopen", "work_item_id": work_item.pk},
    )
    return work_item


@transaction.atomic
def set_prototype_visibility(prototype_id, *, hidden, reason, actor):
    _require_reviewer(actor)
    reason = _required_reason(reason)
    prototype = FigurePrototype.objects.select_for_update().get(pk=prototype_id)
    before = _prototype_snapshot(prototype)
    prototype.is_hidden = bool(hidden)
    prototype.domain_version += 1
    prototype.save(update_fields=["is_hidden", "domain_version"])
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after=_prototype_snapshot(prototype),
        related={
            "action": "prototype_hide" if hidden else "prototype_restore",
            "prototype_id": prototype.pk,
        },
    )
    return prototype


@transaction.atomic
def mark_source_unavailable(source_id, *, unavailable, reason, actor):
    _require_reviewer(actor)
    reason = _required_reason(reason)
    source = SourceRecord.objects.select_for_update().get(pk=source_id)
    before = {"is_unavailable": source.is_unavailable, "prototype_id": source.prototype_id}
    source.is_unavailable = bool(unavailable)
    source.save(update_fields=["is_unavailable", "updated_at"])
    _audit(
        actor=actor,
        operation=OperationLog.Operation.REVIEW,
        reason=reason,
        before=before,
        after={"is_unavailable": source.is_unavailable, "prototype_id": source.prototype_id},
        related={"action": "source_availability", "source_id": source.pk},
    )
    return source


def _move_relation(model, ids, prototype_id, field="prototype"):
    if ids:
        model.objects.filter(pk__in=ids).update(**{f"{field}_id": prototype_id})


@transaction.atomic
def merge_prototypes(
    source_id,
    target_id,
    *,
    reason,
    actor,
    expected_source_version=None,
    expected_target_version=None,
    depends_on_operation_ids=(),
):
    _require_reviewer(actor)
    if source_id == target_id:
        raise ValidationError("Source and target must differ.")
    locked = {
        item.pk: item
        for item in FigurePrototype.objects.select_for_update().filter(
            pk__in=[source_id, target_id]
        )
    }
    if set(locked) != {source_id, target_id}:
        raise FigurePrototype.DoesNotExist
    source, target = locked[source_id], locked[target_id]
    if source.is_merged:
        raise ValidationError("The source prototype has already been merged.")
    if expected_source_version is not None and source.domain_version != expected_source_version:
        raise ValidationError("Source prototype version conflict.")
    if expected_target_version is not None and target.domain_version != expected_target_version:
        raise ValidationError("Target prototype version conflict.")
    before = {"source": _prototype_snapshot(source), "target": _prototype_snapshot(target)}
    moved = {
        "version_ids": list(source.versions.values_list("pk", flat=True)),
        "source_ids": list(source.sources.values_list("pk", flat=True)),
        "candidate_ids": list(source.candidates.values_list("pk", flat=True)),
        "candidate_image_ids": list(source.candidate_images.values_list("pk", flat=True)),
    }
    _move_relation(FigureVersion, moved["version_ids"], target.pk)
    _move_relation(SourceRecord, moved["source_ids"], target.pk)
    _move_relation(CandidateRecord, moved["candidate_ids"], target.pk, "target_prototype")
    _move_relation(CandidateImage, moved["candidate_image_ids"], target.pk)
    target.characters.add(*source.characters.all())
    target.save()
    source.is_merged = True
    source.is_hidden = True
    source.merged_into = target
    source.domain_version += 1
    target.domain_version += 1
    source.save(update_fields=["is_merged", "is_hidden", "merged_into", "domain_version"])
    target.save(update_fields=["domain_version"])
    source.refresh_from_db()
    target.refresh_from_db()
    operation = _audit(
        actor=actor,
        operation=OperationLog.Operation.MERGE,
        reason=reason,
        before=before,
        after={"source": _prototype_snapshot(source), "target": _prototype_snapshot(target)},
        related={
            "source_id": source.pk,
            "target_id": target.pk,
            "moved": moved,
            "depends_on_operation_ids": [str(item) for item in depends_on_operation_ids],
            "versions_after": {
                str(source.pk): source.domain_version,
                str(target.pk): target.domain_version,
            },
        },
        scope=f"prototype:{source.pk},{target.pk}",
        scope_version=max(source.domain_version, target.domain_version),
    )
    return operation


@transaction.atomic
def split_prototype(
    source_id,
    *,
    version_ids=(),
    source_ids=(),
    candidate_ids=(),
    candidate_image_ids=(),
    title,
    reason,
    actor,
    expected_source_version=None,
    depends_on_operation_ids=(),
):
    _require_reviewer(actor)
    source = FigurePrototype.objects.select_for_update().get(pk=source_id)
    if expected_source_version is not None and source.domain_version != expected_source_version:
        raise ValidationError("Split source prototype version conflict.")
    requested = {
        "version_ids": list(dict.fromkeys(version_ids)),
        "source_ids": list(dict.fromkeys(source_ids)),
        "candidate_ids": list(dict.fromkeys(candidate_ids)),
        "candidate_image_ids": list(dict.fromkeys(candidate_image_ids)),
    }
    selected = {
        "version_ids": list(
            source.versions.select_for_update()
            .filter(pk__in=requested["version_ids"])
            .values_list("pk", flat=True)
        ),
        "source_ids": list(
            source.sources.select_for_update()
            .filter(pk__in=requested["source_ids"])
            .values_list("pk", flat=True)
        ),
        "candidate_ids": list(
            source.candidates.select_for_update()
            .filter(pk__in=requested["candidate_ids"])
            .values_list("pk", flat=True)
        ),
        "candidate_image_ids": list(
            source.candidate_images.select_for_update()
            .filter(pk__in=requested["candidate_image_ids"])
            .values_list("pk", flat=True)
        ),
    }
    for relation_name, relation_ids in requested.items():
        if set(relation_ids) != set(selected[relation_name]):
            raise ValidationError(
                f"Every requested {relation_name} relationship must belong to the split source."
            )
    if not any(selected.values()):
        raise ValidationError("A split must move at least one relationship.")

    selected_versions = set(selected["version_ids"])
    selected_sources = set(selected["source_ids"])
    selected_candidates = set(selected["candidate_ids"])
    selected_images = set(selected["candidate_image_ids"])

    candidates = list(
        CandidateRecord.objects.select_for_update()
        .select_related("source", "target_version")
        .filter(pk__in=selected_candidates)
    )
    for candidate in candidates:
        if candidate.source_id not in selected_sources:
            raise ValidationError("A moved candidate must include its SourceRecord.")
        if (
            candidate.target_version_id is not None
            and candidate.target_version_id not in selected_versions
        ):
            raise ValidationError("A moved candidate must include its target FigureVersion.")
        attached_images = set(
            candidate.images.filter(prototype_id=source.pk).values_list("pk", flat=True)
        )
        if not attached_images.issubset(selected_images):
            raise ValidationError(
                "A moved candidate must include every image attached to the source prototype."
            )

    source_candidate_ids = set(
        CandidateRecord.objects.filter(
            source_id__in=selected_sources,
            target_prototype_id=source.pk,
        ).values_list("pk", flat=True)
    )
    if not source_candidate_ids.issubset(selected_candidates):
        raise ValidationError("A moved SourceRecord must include its attached candidate.")

    version_candidate_ids = set(
        CandidateRecord.objects.filter(
            target_version_id__in=selected_versions,
            target_prototype_id=source.pk,
        ).values_list("pk", flat=True)
    )
    if not version_candidate_ids.issubset(selected_candidates):
        raise ValidationError("A moved FigureVersion must include its attached candidates.")

    image_candidate_ids = set(
        CandidateImage.objects.filter(pk__in=selected_images)
        .exclude(candidate_id=None)
        .values_list("candidate_id", flat=True)
    )
    if not image_candidate_ids.issubset(selected_candidates):
        raise ValidationError("A moved candidate image must include its candidate.")
    before = _prototype_snapshot(source)
    new_prototype = FigurePrototype.objects.create(
        title=title,
        work=source.work,
        manufacturer=source.manufacturer,
        figure_type=source.figure_type,
        scale=source.scale,
        costume_skin_text=source.costume_skin_text,
        is_multi_character=source.is_multi_character,
        is_adult=source.is_adult,
        live=False,
        has_unpublished_changes=True,
        # A split never copies a main image implicitly; it needs a later manual choice.
        main_image=None,
    )
    new_prototype.characters.set(source.characters.all())
    new_prototype.save()
    _move_relation(FigureVersion, selected["version_ids"], new_prototype.pk)
    _move_relation(SourceRecord, selected["source_ids"], new_prototype.pk)
    _move_relation(
        CandidateRecord, selected["candidate_ids"], new_prototype.pk, "target_prototype"
    )
    _move_relation(CandidateImage, selected["candidate_image_ids"], new_prototype.pk)
    source.refresh_from_db()
    new_prototype.refresh_from_db()
    source.domain_version += 1
    new_prototype.domain_version += 1
    source.save(update_fields=["domain_version"])
    new_prototype.save(update_fields=["domain_version"])
    return _audit(
        actor=actor,
        operation=OperationLog.Operation.SPLIT,
        reason=reason,
        before={"source": before, "new_prototype": None},
        after={
            "source": _prototype_snapshot(source),
            "new_prototype": _prototype_snapshot(new_prototype),
        },
        related={
            "source_id": source.pk,
            "new_prototype_id": new_prototype.pk,
            "moved": selected,
            "main_image_rule": "no implicit copy; manual selection required",
            "depends_on_operation_ids": [str(item) for item in depends_on_operation_ids],
            "versions_after": {
                str(source.pk): source.domain_version,
                str(new_prototype.pk): new_prototype.domain_version,
            },
        },
        scope=f"prototype:{source.pk},{new_prototype.pk}",
        scope_version=max(source.domain_version, new_prototype.domain_version),
    )


def _operation_prototype_ids(operation):
    related = operation.related_records
    return {
        int(related[key])
        for key in ("source_id", "target_id", "new_prototype_id")
        if related.get(key) is not None
    }


@transaction.atomic
def undo_operation(operation_id, *, reason, actor):
    _require_reviewer(actor)
    reason = _required_reason(reason)
    operation = OperationLog.objects.select_for_update().filter(
        operation_id=operation_id,
        operation__in=[OperationLog.Operation.MERGE, OperationLog.Operation.SPLIT],
        is_undone=False,
    ).first()
    if operation is None:
        raise ValidationError("The requested merge/split operation is absent or already undone.")
    current_ids = _operation_prototype_ids(operation)
    current_operation_id = str(operation.operation_id)
    later = list(
        OperationLog.objects.select_for_update()
        .filter(
            operation__in=[OperationLog.Operation.MERGE, OperationLog.Operation.SPLIT],
            is_undone=False,
            pk__gt=operation.pk,
        )
        .order_by("pk")
    )
    blockers = [
        item
        for item in later
        if current_operation_id in item.related_records.get("depends_on_operation_ids", [])
        or bool(current_ids.intersection(_operation_prototype_ids(item)))
    ]
    if blockers:
        raise ValidationError(
            "Cannot undo an operation with active dependants: "
            + ", ".join(str(item.operation_id) for item in blockers)
        )
    related = operation.related_records
    moved = related["moved"]
    if operation.operation == OperationLog.Operation.SPLIT:
        source = FigurePrototype.objects.select_for_update().get(pk=related["source_id"])
        new_prototype = FigurePrototype.objects.select_for_update().get(
            pk=related["new_prototype_id"]
        )
        _move_relation(FigureVersion, moved["version_ids"], source.pk)
        _move_relation(SourceRecord, moved["source_ids"], source.pk)
        _move_relation(CandidateRecord, moved["candidate_ids"], source.pk, "target_prototype")
        _move_relation(CandidateImage, moved["candidate_image_ids"], source.pk)
        new_prototype.is_soft_deleted = True
        new_prototype.is_hidden = True
        new_prototype.live = False
        new_prototype.main_image = None
        source.domain_version += 1
        new_prototype.domain_version += 1
        new_prototype.save(
            update_fields=[
                "is_soft_deleted",
                "is_hidden",
                "live",
                "main_image",
                "domain_version",
            ]
        )
        source.save(update_fields=["domain_version"])
        affected = {"restored_to": source.pk, "retained_tombstone": new_prototype.pk}
    else:
        source = FigurePrototype.objects.select_for_update().get(pk=related["source_id"])
        target = FigurePrototype.objects.select_for_update().get(pk=related["target_id"])
        _move_relation(FigureVersion, moved["version_ids"], source.pk)
        _move_relation(SourceRecord, moved["source_ids"], source.pk)
        _move_relation(CandidateRecord, moved["candidate_ids"], source.pk, "target_prototype")
        _move_relation(CandidateImage, moved["candidate_image_ids"], source.pk)
        source_before = operation.before_state["source"]
        source.is_merged = source_before["is_merged"]
        source.is_hidden = source_before["is_hidden"]
        source.is_soft_deleted = source_before["is_soft_deleted"]
        source.merged_into_id = source_before["merged_into_id"]
        source.domain_version += 1
        target.domain_version += 1
        source.save(
            update_fields=[
                "is_merged",
                "is_hidden",
                "is_soft_deleted",
                "merged_into",
                "domain_version",
            ]
        )
        target.characters.set(operation.before_state["target"]["character_ids"])
        target.save(update_fields=["domain_version"])
        affected = {"restored_source": source.pk, "target": target.pk}

    operation.is_undone = True
    operation.save(update_fields=["is_undone"])
    return OperationLog.objects.create(
        actor=actor,
        actor_label=_actor_label(actor),
        operation=OperationLog.Operation.UNDO,
        reason=reason,
        before_state=deepcopy(operation.after_state),
        after_state=deepcopy(operation.before_state),
        related_records={"undone_operation_id": operation.pk, **affected},
        undo_of=operation,
        scope=operation.scope,
        scope_version=operation.scope_version + 1,
    )
