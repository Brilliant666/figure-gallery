import json
from ipaddress import ip_address

from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.paginator import Paginator
from django.db import connection
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .candidate_service import CandidateIngressError, upsert_candidate
from .candidate_media import import_candidate_image
from .client_identity import authenticate_candidate_client
from .forms import CandidateReviewForm, DomainOperationForm
from .models import (
    CandidateRecord,
    Character,
    FigurePrototype,
    Manufacturer,
    OperationLog,
    ReviewWorkItem,
    SystemSetting,
    Work,
)
from .services import (
    attach_review_work_item_to_version,
    complete_review_work_item,
    create_manufacturer,
    create_prototype_from_review_work_item,
    create_review_work_item,
    decide_review_work_item_field,
    maintain_character,
    maintain_figure_version,
    maintain_prototype_metadata,
    maintain_work,
    mark_source_unavailable,
    merge_prototypes,
    reopen_review_work_item,
    review_work_item_status,
    select_review_work_item_main_image,
    select_main_image,
    set_manufacturer_status,
    set_prototype_visibility,
    split_prototype,
    undo_operation,
    update_system_settings,
)


def _bearer_token(request):
    value = request.headers.get("Authorization", "")
    prefix = "Bearer "
    return value[len(prefix) :] if value.startswith(prefix) else ""


def _is_loopback_request(request):
    try:
        return ip_address(str(request.META.get("REMOTE_ADDR", ""))).is_loopback
    except ValueError:
        return False


@csrf_exempt
@require_http_methods(["POST"])
def candidate_upsert_api(request):
    """The only HTTP write surface available to the Python candidate client."""

    if not _is_loopback_request(request):
        return JsonResponse({"ok": False, "error": "loopback access required"}, status=403)
    if request.content_type != "application/json":
        return JsonResponse({"ok": False, "error": "application/json required"}, status=415)
    if len(request.body) > 262_144:
        return JsonResponse({"ok": False, "error": "payload too large"}, status=413)
    try:
        document = json.loads(request.body)
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "invalid JSON"}, status=400)
    if document.get("protocol_version") != 1 or document.get("operation") != "candidate_upsert":
        return JsonResponse({"ok": False, "error": "unsupported candidate protocol"}, status=403)
    candidate_payload = document.get("candidate")
    if not isinstance(candidate_payload, dict):
        return JsonResponse({"ok": False, "error": "candidate object required"}, status=400)
    try:
        owner = authenticate_candidate_client(
            client_id=document.get("client_id")
            or request.headers.get("X-Candidate-Client-Id"),
            token=_bearer_token(request),
        )
        result = upsert_candidate(
            candidate_payload,
            actor_label=f"candidate-client:{owner.client_id}",
            owner=owner,
        )
    except PermissionDenied as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    except CandidateIngressError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=403)
    return JsonResponse({"ok": True, **result}, status=201 if result["outcome"] == "new" else 200)


@csrf_exempt
@require_http_methods(["POST"])
def candidate_media_upload_api(request):
    """Protocol-v2 multipart upload; no formal-data write path exists here."""

    if not _is_loopback_request(request):
        return JsonResponse({"ok": False, "error": "loopback access required"}, status=403)
    if not request.content_type.startswith("multipart/form-data"):
        return JsonResponse({"ok": False, "error": "multipart/form-data required"}, status=415)
    try:
        metadata = json.loads(request.POST.get("metadata", ""))
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "invalid metadata JSON"}, status=400)
    if metadata.get("protocol_version") != 2 or metadata.get("operation") != "candidate_media_upload":
        return JsonResponse({"ok": False, "error": "unsupported candidate protocol"}, status=403)
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"ok": False, "error": "file is required"}, status=400)
    try:
        owner = authenticate_candidate_client(
            client_id=metadata.get("client_id")
            or request.headers.get("X-Candidate-Client-Id"),
            token=_bearer_token(request),
        )
        result = import_candidate_image(owner=owner, metadata=metadata, uploaded_file=upload)
    except PermissionDenied as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    except (ValidationError, ValueError) as exc:
        detail = exc.messages[0] if isinstance(exc, ValidationError) else str(exc)
        status = 403 if "another client" in detail.lower() else 400
        return JsonResponse({"ok": False, "error": detail}, status=status)
    return JsonResponse({"ok": True, **result}, status=201 if result["outcome"] == "new" else 200)


@require_GET
def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        database_ok = cursor.fetchone() == (1,)
    return JsonResponse(
        {"ok": database_ok, "service": "val02b-wagtail-spike"},
        status=200 if database_ok else 503,
    )


@require_GET
def home(request):
    return render(request, "gallery/home.html")


def _character_matches(character, query):
    needle = query.casefold()
    names = {
        character.display_name,
        character.name_zh,
        character.name_ja,
        character.name_en,
        *(str(item) for item in character.aliases),
    }
    return any(needle == value.strip().casefold() for value in names if value)


@require_GET
def character_search(request):
    query = request.GET.get("q", "").strip()
    if not query:
        return render(request, "gallery/search_results.html", {"query": query, "matches": []})
    matches = [
        character
        for character in Character.objects.select_related("work").filter(
            is_hidden=False, is_soft_deleted=False
        )
        if _character_matches(character, query)
    ]
    if len(matches) == 1:
        return redirect("gallery:character_gallery", character_id=matches[0].pk)
    return render(
        request,
        "gallery/search_results.html",
        {"query": query, "matches": matches},
    )


@require_GET
def character_gallery(request, character_id):
    character = get_object_or_404(
        Character.objects.select_related("work"),
        pk=character_id,
        is_hidden=False,
        is_soft_deleted=False,
    )
    config = SystemSetting.load()
    if not config.public_access_enabled:
        return render(request, "gallery/public_disabled.html", status=503)
    prototypes = (
        FigurePrototype.objects.filter(
            characters=character,
            live=True,
            is_hidden=False,
            is_soft_deleted=False,
            is_merged=False,
            manufacturer__status=Manufacturer.Status.ACTIVE,
            main_image__isnull=False,
        )
        .select_related("main_image")
        .prefetch_related("candidate_images")
        .distinct()
        .order_by("pk")
    )
    if not config.show_adult_images:
        prototypes = prototypes.exclude(
            candidate_images__selected_as_main=True,
            candidate_images__is_adult=True,
        )
    page = Paginator(prototypes, config.page_size).get_page(request.GET.get("page", 1))
    cards = []
    for prototype in page.object_list:
        rendition = prototype.main_image.get_rendition("max-720x720")
        cards.append(
            {
                "prototype": prototype,
                "url": rendition.url,
                "width": rendition.width,
                "height": rendition.height,
            }
        )
    return render(
        request,
        "gallery/character_gallery.html",
        {"character": character, "page": page, "cards": cards},
    )


@staff_member_required
@require_http_methods(["GET", "POST"])
def candidate_review(request, pk):
    candidate = get_object_or_404(
        CandidateRecord.objects.select_related(
            "source", "target_prototype", "target_version"
        ).prefetch_related("images__image"),
        pk=pk,
    )
    requested_work_item_id = (
        request.POST.get("work_item_id") if request.method == "POST" else None
    )
    if requested_work_item_id:
        work_item = get_object_or_404(
            ReviewWorkItem.objects.prefetch_related("allowed_targets"),
            pk=requested_work_item_id,
            candidate=candidate,
        )
    else:
        work_item = (
            candidate.review_work_items.filter(status=ReviewWorkItem.Status.OPEN)
            .prefetch_related("allowed_targets")
            .first()
        )
        if work_item is None:
            work_item = (
                candidate.review_work_items.prefetch_related("allowed_targets")
                .order_by("-pk")
                .first()
            )
            if work_item is None:
                allowed = (
                    [candidate.target_prototype_id]
                    if candidate.target_prototype_id
                    else []
                )
                work_item = create_review_work_item(
                    candidate.pk,
                    allowed_target_ids=allowed,
                    reason="Opened candidate review from the audited Wagtail admin entry",
                    actor=request.user,
                )
    form = CandidateReviewForm(
        request.POST or None,
        candidate=candidate,
        work_item=work_item,
    )
    if request.method == "POST" and form.is_valid():
        action = form.cleaned_data["action"]
        reason = form.cleaned_data["reason"]
        expected_version = form.cleaned_data["expected_version"]
        try:
            if action in {"defer", "ignore"}:
                review_work_item_status(
                    work_item.pk,
                    expected_version=expected_version,
                    status=(
                        CandidateRecord.Status.DEFERRED
                        if action == "defer"
                        else CandidateRecord.Status.IGNORED
                    ),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "create":
                create_prototype_from_review_work_item(
                    work_item.pk,
                    expected_version=expected_version,
                    title=form.cleaned_data["title"],
                    manufacturer=form.cleaned_data["manufacturer"],
                    characters=form.cleaned_data["characters"],
                    work=form.cleaned_data["work"],
                    figure_type=form.cleaned_data["figure_type"],
                    scale=form.cleaned_data["scale"],
                    main_candidate_image=form.cleaned_data["candidate_image"],
                    reason=reason,
                    actor=request.user,
                )
            elif action == "attach":
                attach_review_work_item_to_version(
                    work_item.pk,
                    expected_version=expected_version,
                    version_id=form.cleaned_data["target_version"].pk,
                    reason=reason,
                    actor=request.user,
                )
            elif action in {"accept_field", "reject_field"}:
                decide_review_work_item_field(
                    work_item.pk,
                    expected_version=expected_version,
                    field_name=form.cleaned_data["field_name"],
                    accept=action == "accept_field",
                    reason=reason,
                    actor=request.user,
                    target_prototype_id=(
                        form.cleaned_data["target_prototype"].pk
                        if form.cleaned_data.get("target_prototype")
                        else None
                    ),
                )
            elif action == "select_main":
                image = form.cleaned_data["candidate_image"]
                select_review_work_item_main_image(
                    work_item.pk,
                    expected_version=expected_version,
                    prototype_id=form.cleaned_data["target_prototype"].pk,
                    candidate_image_id=image.pk,
                    reason=reason,
                    actor=request.user,
                )
            elif action == "complete":
                complete_review_work_item(
                    work_item.pk,
                    expected_version=expected_version,
                    reason=reason,
                    actor=request.user,
                )
        except (PermissionDenied, ValidationError) as exc:
            detail = exc.messages[0] if isinstance(exc, ValidationError) else str(exc)
            form.add_error(None, detail)
            status = 409 if "conflict" in detail.lower() else 403
            return render(
                request,
                "gallery/admin/candidate_review.html",
                _candidate_review_context(candidate, form, work_item),
                status=status,
            )
        messages.success(request, "Candidate review action recorded with an operation log.")
        return HttpResponseRedirect(reverse("candidate_review", args=[candidate.pk]))
    return render(
        request,
        "gallery/admin/candidate_review.html",
        _candidate_review_context(candidate, form, work_item),
    )


def _candidate_review_context(candidate, form, work_item):
    logs = OperationLog.objects.filter(
        related_records__candidate_id=candidate.pk
    ).order_by("-pk")[:12]
    return {
        "candidate": candidate,
        "form": form,
        "work_item": work_item,
        "operation_logs": logs,
    }


@staff_member_required
@require_http_methods(["GET", "POST"])
def domain_operations(request):
    """Minimal Wagtail Admin command console backed only by audited services."""

    form = DomainOperationForm(request.POST or None)
    status = 200
    if request.method == "POST" and form.is_valid():
        action = form.cleaned_data["action"]
        reason = form.cleaned_data["reason"]
        payload = form.cleaned_data["payload"]
        try:
            if action == "work":
                maintain_work(
                    work_id=payload.get("work_id"),
                    name=payload["name"],
                    original_name=payload.get("original_name", ""),
                    aliases=payload.get("aliases", []),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "character":
                work = (
                    Work.objects.get(pk=payload["work_id"])
                    if payload.get("work_id") is not None
                    else None
                )
                maintain_character(
                    character_id=payload.get("character_id"),
                    display_name=payload["display_name"],
                    name_zh=payload.get("name_zh", ""),
                    name_ja=payload.get("name_ja", ""),
                    name_en=payload.get("name_en", ""),
                    aliases=payload.get("aliases", []),
                    work=work,
                    is_hidden=payload.get("is_hidden", False),
                    is_soft_deleted=payload.get("is_soft_deleted", False),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "manufacturer_create":
                create_manufacturer(
                    name=payload["name"],
                    aliases=payload.get("aliases", []),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "manufacturer_status":
                set_manufacturer_status(
                    payload["manufacturer_id"],
                    status=payload["status"],
                    reason=reason,
                    actor=request.user,
                )
            elif action == "version":
                maintain_figure_version(
                    version_id=payload.get("version_id"),
                    prototype_id=payload["prototype_id"],
                    name=payload["name"],
                    kind=payload["kind"],
                    notes=payload.get("notes", ""),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "prototype":
                maintain_prototype_metadata(
                    payload["prototype_id"],
                    expected_version=payload["expected_version"],
                    title=payload.get("title"),
                    live=payload.get("live"),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "settings":
                allowed = {
                    key: payload[key]
                    for key in (
                        "show_adult_images",
                        "page_size",
                        "public_access_enabled",
                    )
                    if key in payload
                }
                update_system_settings(reason=reason, actor=request.user, **allowed)
            elif action == "source_unavailable":
                mark_source_unavailable(
                    payload["source_id"],
                    unavailable=payload["unavailable"],
                    reason=reason,
                    actor=request.user,
                )
            elif action in {"hide", "restore"}:
                set_prototype_visibility(
                    payload["prototype_id"],
                    hidden=action == "hide",
                    reason=reason,
                    actor=request.user,
                )
            elif action == "main_image":
                select_main_image(
                    payload["prototype_id"],
                    payload["candidate_image_id"],
                    attach_if_unassigned=True,
                    reason=reason,
                    actor=request.user,
                )
            elif action == "merge":
                merge_prototypes(
                    payload["source_id"],
                    payload["target_id"],
                    expected_source_version=payload.get("expected_source_version"),
                    expected_target_version=payload.get("expected_target_version"),
                    depends_on_operation_ids=payload.get("depends_on_operation_ids", []),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "split":
                split_prototype(
                    payload["source_id"],
                    version_ids=payload.get("version_ids", []),
                    source_ids=payload.get("source_ids", []),
                    candidate_ids=payload.get("candidate_ids", []),
                    candidate_image_ids=payload.get("candidate_image_ids", []),
                    title=payload["title"],
                    expected_source_version=payload.get("expected_source_version"),
                    depends_on_operation_ids=payload.get("depends_on_operation_ids", []),
                    reason=reason,
                    actor=request.user,
                )
            elif action == "undo":
                undo_operation(payload["operation_id"], reason=reason, actor=request.user)
            elif action == "reopen_review":
                reopen_review_work_item(
                    payload["work_item_id"], reason=reason, actor=request.user
                )
        except (KeyError, TypeError, ValueError, PermissionDenied, ValidationError) as exc:
            detail = exc.messages[0] if isinstance(exc, ValidationError) else str(exc)
            form.add_error(None, detail)
            status = 409 if "conflict" in detail.lower() else 400
        else:
            messages.success(request, "Audited domain operation completed.")
            return HttpResponseRedirect(reverse("domain_operations"))
    return render(
        request,
        "gallery/admin/domain_operations.html",
        {
            "form": form,
            "counts": {
                "works": Work.objects.count(),
                "characters": Character.objects.count(),
                "manufacturers": Manufacturer.objects.count(),
                "prototypes": FigurePrototype.objects.count(),
                "candidates": CandidateRecord.objects.count(),
                "review_items": ReviewWorkItem.objects.count(),
            },
        },
        status=status,
    )
