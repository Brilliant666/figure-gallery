"""Relationship-heavy domain model used only by the VAL-02 Wagtail spike."""

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from modelcluster.fields import ParentalManyToManyField
from modelcluster.models import ClusterableModel
from wagtail.admin.panels import FieldPanel, MultiFieldPanel, PublishingPanel
from wagtail.models import DraftStateMixin, RevisionMixin, WorkflowMixin
from wagtail.search import index


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Work(TimeStampedModel):
    name = models.CharField(max_length=200)
    original_name = models.CharField(max_length=200, blank=True)
    aliases = models.JSONField(default=list, blank=True)

    def __str__(self):
        return self.name


class Character(TimeStampedModel):
    display_name = models.CharField(max_length=200)
    name_zh = models.CharField(max_length=200, blank=True)
    name_ja = models.CharField(max_length=200, blank=True)
    name_en = models.CharField(max_length=200, blank=True)
    aliases = models.JSONField(default=list, blank=True)
    work = models.ForeignKey(
        Work, null=True, blank=True, on_delete=models.SET_NULL, related_name="characters"
    )
    is_hidden = models.BooleanField(default=False)
    is_soft_deleted = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.display_name} · {self.work}" if self.work else self.display_name


class Manufacturer(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        HIDDEN = "hidden", "Hidden"

    name = models.CharField(max_length=200, unique=True)
    aliases = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)

    def __str__(self):
        return self.name


class FigurePrototype(
    WorkflowMixin,
    DraftStateMixin,
    RevisionMixin,
    index.Indexed,
    TimeStampedModel,
    ClusterableModel,
):
    """A gallery entry: one sculpt/prototype, never a sale SKU or version."""

    class FigureType(models.TextChoices):
        SCALE = "scale", "Scale figure"
        PRIZE = "prize", "Prize figure"

    title = models.CharField(max_length=240)
    characters = ParentalManyToManyField(Character, related_name="figure_prototypes")
    work = models.ForeignKey(
        Work, null=True, blank=True, on_delete=models.SET_NULL, related_name="prototypes"
    )
    manufacturer = models.ForeignKey(
        Manufacturer, on_delete=models.PROTECT, related_name="prototypes"
    )
    figure_type = models.CharField(max_length=16, choices=FigureType.choices)
    scale = models.CharField(max_length=40, blank=True)
    costume_skin_text = models.CharField(max_length=240, blank=True)
    is_multi_character = models.BooleanField(default=False)
    is_adult = models.BooleanField(default=False)
    is_hidden = models.BooleanField(default=False)
    is_soft_deleted = models.BooleanField(default=False)
    is_merged = models.BooleanField(default=False)
    domain_version = models.PositiveBigIntegerField(default=1)
    merged_into = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="merged_records",
    )
    main_image = models.ForeignKey(
        "wagtailimages.Image",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="figure_gallery_main_for",
    )

    panels = [
        FieldPanel("title"),
        MultiFieldPanel(
            [
                FieldPanel("characters"),
                FieldPanel("work"),
                FieldPanel("manufacturer"),
            ],
            heading="Identity",
        ),
        MultiFieldPanel(
            [
                FieldPanel("figure_type"),
                FieldPanel("scale"),
                FieldPanel("costume_skin_text"),
                FieldPanel("is_multi_character"),
                FieldPanel("is_adult"),
            ],
            heading="Figure details",
        ),
        # Main-image selection is intentionally absent from generic Wagtail forms;
        # the audited candidate-review action is the only administrative write path.
        MultiFieldPanel(
            [FieldPanel("is_hidden"), FieldPanel("is_soft_deleted")],
            heading="Visibility",
        ),
        PublishingPanel(),
    ]

    search_fields = [
        index.SearchField("title", partial_match=True),
        index.RelatedFields(
            "characters",
            [
                index.SearchField("display_name", partial_match=True),
                index.SearchField("name_zh", partial_match=True),
                index.SearchField("name_ja", partial_match=True),
                index.SearchField("name_en", partial_match=True),
            ],
        ),
    ]

    def clean(self):
        super().clean()
        if self.merged_into_id == self.pk and self.pk:
            raise ValidationError({"merged_into": "A prototype cannot merge into itself."})

    def __str__(self):
        return self.title


class FigureVersion(TimeStampedModel):
    class Kind(models.TextChoices):
        STANDARD = "standard", "Standard"
        DELUXE = "deluxe", "Deluxe"
        REISSUE = "reissue", "Reissue"
        BONUS = "bonus", "Bonus"
        RECOLOR = "recolor", "Recolor"
        CHANNEL = "channel", "Channel exclusive"

    prototype = models.ForeignKey(
        FigurePrototype, on_delete=models.PROTECT, related_name="versions"
    )
    name = models.CharField(max_length=160)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.prototype} / {self.name}"


class SourceRecord(TimeStampedModel):
    source_type = models.CharField(max_length=40)
    source_item_id = models.CharField(max_length=160, blank=True)
    source_url = models.URLField(max_length=1000)
    normalized_url = models.URLField(max_length=1000)
    source_status = models.CharField(max_length=80, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    is_unavailable = models.BooleanField(default=False)
    raw_snapshot = models.JSONField(default=dict, blank=True)
    prototype = models.ForeignKey(
        FigurePrototype,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="sources",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_item_id"],
                condition=~Q(source_item_id=""),
                name="gallery_unique_source_stable_id",
            ),
            models.UniqueConstraint(
                fields=["source_type", "normalized_url"],
                condition=Q(source_item_id=""),
                name="gallery_unique_source_url_fallback",
            ),
        ]

    @property
    def identity_key(self):
        if self.source_item_id:
            return f"{self.source_type}:id:{self.source_item_id}"
        return f"{self.source_type}:url:{self.normalized_url}"

    def __str__(self):
        return self.identity_key


class CandidateRecord(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DEFERRED = "deferred", "Deferred"
        IGNORED = "ignored", "Ignored"
        MERGED = "merged", "Merged"
        UPDATE_PENDING = "update_pending", "Update pending"

    source = models.OneToOneField(
        SourceRecord, on_delete=models.PROTECT, related_name="candidate"
    )
    owner = models.ForeignKey(
        "CandidateClientCredential",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="candidates",
    )
    client_candidate_id = models.CharField(max_length=200, blank=True)
    raw_title = models.CharField(max_length=500)
    raw_character_names = models.JSONField(default=list, blank=True)
    raw_work_name = models.CharField(max_length=240, blank=True)
    raw_manufacturer = models.CharField(max_length=240, blank=True)
    raw_category = models.CharField(max_length=120, blank=True)
    raw_scale = models.CharField(max_length=80, blank=True)
    raw_release_date = models.CharField(max_length=100, blank=True)
    raw_snapshot = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=24, choices=Status.choices, default=Status.PENDING
    )
    review_reason = models.TextField(blank=True)
    field_decisions = models.JSONField(default=dict, blank=True)
    unmatched_character_names = models.JSONField(default=list, blank=True)
    unmatched_manufacturer_name = models.CharField(max_length=240, blank=True)
    target_prototype = models.ForeignKey(
        FigurePrototype,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="candidates",
    )
    target_version = models.ForeignKey(
        FigureVersion,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="candidates",
    )

    def __str__(self):
        return f"{self.raw_title} [{self.status}]"

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "client_candidate_id"],
                condition=~Q(client_candidate_id=""),
                name="gallery_unique_client_candidate_id",
            )
        ]


class CandidateImage(TimeStampedModel):
    candidate = models.ForeignKey(
        CandidateRecord,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="images",
    )
    prototype = models.ForeignKey(
        FigurePrototype,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="candidate_images",
    )
    image = models.ForeignKey(
        "wagtailimages.Image",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="figure_gallery_candidates",
    )
    original_url = models.URLField(max_length=1000, blank=True)
    client_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    idempotency_key = models.CharField(max_length=200, blank=True)
    storage_key = models.CharField(max_length=500)
    file_size = models.PositiveBigIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    format = models.CharField(max_length=20)
    sha256 = models.CharField(max_length=64)
    perceptual_hash = models.CharField(max_length=64, blank=True)
    is_adult = models.BooleanField(default=False)
    is_source_homepage = models.BooleanField(default=False)
    exists_in_latest_source = models.BooleanField(default=True)
    selected_as_main = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(candidate__isnull=False) | Q(prototype__isnull=False),
                name="gallery_candidate_image_has_owner",
            ),
            models.UniqueConstraint(
                fields=["candidate", "storage_key"],
                condition=Q(candidate__isnull=False),
                name="gallery_unique_candidate_storage_key",
            ),
            models.UniqueConstraint(
                fields=["candidate", "idempotency_key"],
                condition=~Q(idempotency_key=""),
                name="gallery_unique_candidate_media_idempotency",
            ),
        ]

    def __str__(self):
        return self.storage_key


class CandidateUploadReceipt(TimeStampedModel):
    """Bind a client idempotency key to one validated content digest."""

    owner = models.ForeignKey(
        "CandidateClientCredential",
        on_delete=models.PROTECT,
        related_name="upload_receipts",
    )
    candidate = models.ForeignKey(
        CandidateRecord,
        on_delete=models.PROTECT,
        related_name="upload_receipts",
    )
    candidate_image = models.ForeignKey(
        CandidateImage,
        on_delete=models.PROTECT,
        related_name="upload_receipts",
    )
    idempotency_key = models.CharField(max_length=200)
    sha256 = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "idempotency_key"],
                name="gallery_unique_client_upload_idempotency",
            )
        ]

    def __str__(self):
        return f"{self.owner.client_id}:{self.idempotency_key}"


class OperationLog(models.Model):
    class Operation(models.TextChoices):
        CANDIDATE_UPSERT = "candidate_upsert", "Candidate upsert"
        REVIEW = "review", "Candidate review"
        MAIN_IMAGE = "main_image", "Main image selection"
        CLIENT_IDENTITY = "client_identity", "Candidate client identity"
        REVIEW_WORK = "review_work", "Review work item"
        MERGE = "merge", "Merge"
        SPLIT = "split", "Split"
        UNDO = "undo", "Undo"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="figure_gallery_operations",
    )
    operation_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    scope = models.CharField(max_length=200, default="gallery")
    scope_version = models.PositiveBigIntegerField(default=1)
    actor_label = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    operation = models.CharField(max_length=32, choices=Operation.choices)
    reason = models.TextField()
    before_state = models.JSONField(default=dict)
    after_state = models.JSONField(default=dict)
    related_records = models.JSONField(default=dict)
    is_undone = models.BooleanField(default=False)
    undo_of = models.OneToOneField(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="undo_record",
    )

    class Meta:
        ordering = ["created_at", "pk"]

    def __str__(self):
        return f"{self.operation} by {self.actor_label} at {self.created_at}"


class SystemSetting(models.Model):
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True)
    show_adult_images = models.BooleanField(default=False)
    page_size = models.PositiveSmallIntegerField(default=16)
    public_access_enabled = models.BooleanField(default=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(singleton_key=1)
        return obj

    def clean(self):
        if self.page_size < 1 or self.page_size > 100:
            raise ValidationError({"page_size": "Page size must be between 1 and 100."})

    def __str__(self):
        return "Gallery settings"


class CandidateClientCredential(TimeStampedModel):
    """Revocable candidate-only identity; the bearer secret is never stored."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        DISABLED = "disabled", "Disabled"

    client_id = models.CharField(max_length=120, unique=True)
    token_hash = models.CharField(max_length=64, unique=True)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.ACTIVE
    )
    disabled_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.client_id} [{self.status}]"


class ReviewWorkItem(TimeStampedModel):
    """Explicit authorization and optimistic-lock boundary for one review."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        COMPLETED = "completed", "Completed"

    candidate = models.ForeignKey(
        CandidateRecord, on_delete=models.PROTECT, related_name="review_work_items"
    )
    allowed_targets = models.ManyToManyField(
        FigurePrototype, blank=True, related_name="authorized_review_work_items"
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="figure_gallery_review_work_items",
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.OPEN
    )
    lock_version = models.PositiveBigIntegerField(default=1)
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    reopen_count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["candidate"],
                condition=Q(status="open"),
                name="gallery_one_open_review_per_candidate",
            )
        ]

    def __str__(self):
        return f"Review {self.pk}: {self.candidate} [{self.status}]"
