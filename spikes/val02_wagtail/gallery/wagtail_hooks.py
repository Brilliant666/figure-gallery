from django.urls import path, reverse
from django.contrib.auth import get_user_model
from wagtail import hooks
from wagtail.admin.menu import MenuItem
from wagtail.admin.widgets import Button
from wagtail.snippets.models import register_snippet
from wagtail.snippets.views.snippets import SnippetViewSet
from wagtail.permission_policies import ModelPermissionPolicy

from . import views
from .models import (
    CandidateClientCredential,
    CandidateImage,
    CandidateRecord,
    CandidateUploadReceipt,
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


class ReadOnlySnippetPermissionPolicy(ModelPermissionPolicy):
    """Keep generic Wagtail forms from bypassing audited domain services."""

    read_actions = {"view", "inspect", "choose"}

    def user_has_permission(self, user, action):
        return bool(
            user.is_authenticated
            and user.is_active
            and user.is_staff
            and action in self.read_actions
        )

    def users_with_any_permission(self, actions):
        if self.read_actions.intersection(actions):
            return get_user_model().objects.filter(is_active=True, is_staff=True)
        return get_user_model().objects.none()


class ReadOnlySnippetViewSet(SnippetViewSet):
    inspect_view_enabled = True
    copy_view_enabled = False

    @property
    def permission_policy(self):
        return ReadOnlySnippetPermissionPolicy(self.model)


class CandidateRecordViewSet(ReadOnlySnippetViewSet):
    model = CandidateRecord
    icon = "tasks"
    menu_label = "Candidate pool"
    menu_order = 100
    list_display = ["raw_title", "status", "raw_manufacturer", "updated_at"]
    list_filter = ["status"]
    search_fields = ["raw_title", "raw_manufacturer", "raw_work_name"]
    inspect_view_enabled = True


class FigurePrototypeViewSet(ReadOnlySnippetViewSet):
    model = FigurePrototype
    icon = "image"
    menu_label = "Figure prototypes"
    menu_order = 110
    list_display = ["title", "manufacturer", "figure_type", "live", "is_hidden"]
    list_filter = ["figure_type", "live", "is_hidden", "is_soft_deleted"]
    search_fields = ["title"]
    inspect_view_enabled = True


class ManufacturerViewSet(ReadOnlySnippetViewSet):
    model = Manufacturer
    icon = "tag"
    menu_label = "Manufacturers (read only)"
    list_display = ["name", "status", "updated_at"]


class SystemSettingViewSet(ReadOnlySnippetViewSet):
    model = SystemSetting
    icon = "cog"
    menu_label = "Gallery settings (read only)"
    list_display = ["show_adult_images", "page_size", "public_access_enabled"]


register_snippet(CandidateRecordViewSet)
register_snippet(FigurePrototypeViewSet)
register_snippet(ManufacturerViewSet)
register_snippet(SystemSettingViewSet)

for model, label, order in (
    (Work, "Works (read only)", 120),
    (Character, "Characters (read only)", 121),
    (FigureVersion, "Figure versions (read only)", 122),
    (SourceRecord, "Sources (read only)", 123),
    (CandidateImage, "Candidate images (read only)", 124),
    (ReviewWorkItem, "Review work items (read only)", 125),
    (OperationLog, "Operation logs (read only)", 126),
    (CandidateClientCredential, "Candidate clients (read only)", 127),
    (CandidateUploadReceipt, "Upload receipts (read only)", 128),
):
    viewset = type(
        f"{model.__name__}ReadOnlyViewSet",
        (ReadOnlySnippetViewSet,),
        {
            "model": model,
            "icon": "list-ul",
            "menu_label": label,
            "menu_order": order,
            "__module__": __name__,
        },
    )
    register_snippet(viewset)


@hooks.register("register_admin_urls")
def register_candidate_review_url():
    return [
        path(
            "candidate-review/<int:pk>/",
            views.candidate_review,
            name="candidate_review",
        ),
        path(
            "domain-operations/",
            views.domain_operations,
            name="domain_operations",
        ),
    ]


@hooks.register("register_admin_menu_item")
def register_domain_operations_menu_item():
    return MenuItem(
        "Audited domain operations",
        reverse("domain_operations"),
        icon_name="cogs",
        order=90,
    )


@hooks.register("construct_snippet_listing_buttons")
def add_candidate_review_button(buttons, snippet, user, context=None):
    if isinstance(snippet, CandidateRecord) and user.is_staff:
        buttons.append(
            Button(
                label="Review candidate",
                url=reverse("candidate_review", args=[snippet.pk]),
                priority=5,
            )
        )
