import json
from ipaddress import ip_address
from secrets import compare_digest

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.core.paginator import Paginator
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .candidate_service import CandidateIngressError, upsert_candidate
from .forms import CandidateReviewForm
from .models import CandidateRecord, Character, FigurePrototype, Manufacturer, SystemSetting
from .services import (
    attach_candidate_to_version,
    create_prototype_from_candidate,
    decide_candidate_field,
    review_candidate_status,
    select_main_image,
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
    configured = settings.CANDIDATE_API_KEY
    if not configured:
        return JsonResponse({"ok": False, "error": "candidate API is disabled"}, status=503)
    supplied = _bearer_token(request)
    if not supplied or not compare_digest(supplied, configured):
        return JsonResponse({"ok": False, "error": "unauthorized"}, status=401)
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
        result = upsert_candidate(candidate_payload, actor_label="candidate-api-key")
    except CandidateIngressError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=403)
    return JsonResponse({"ok": True, **result}, status=201 if result["outcome"] == "new" else 200)


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
    form = CandidateReviewForm(request.POST or None, candidate=candidate)
    if request.method == "POST" and form.is_valid():
        action = form.cleaned_data["action"]
        reason = form.cleaned_data["reason"]
        if action == "defer":
            review_candidate_status(
                candidate.pk,
                status=CandidateRecord.Status.DEFERRED,
                reason=reason,
                actor=request.user,
            )
        elif action == "ignore":
            review_candidate_status(
                candidate.pk,
                status=CandidateRecord.Status.IGNORED,
                reason=reason,
                actor=request.user,
            )
        elif action == "create":
            create_prototype_from_candidate(
                candidate.pk,
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
            attach_candidate_to_version(
                candidate.pk,
                form.cleaned_data["target_version"].pk,
                reason=reason,
                actor=request.user,
            )
        elif action in {"accept_field", "reject_field"}:
            decide_candidate_field(
                candidate.pk,
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
            select_main_image(
                form.cleaned_data["target_prototype"].pk,
                image.pk,
                reason=reason,
                actor=request.user,
                attach_if_unassigned=True,
            )
        messages.success(request, "Candidate review action recorded with an operation log.")
        return HttpResponseRedirect(reverse("candidate_review", args=[candidate.pk]))
    return render(
        request,
        "gallery/admin/candidate_review.html",
        {"candidate": candidate, "form": form},
    )
