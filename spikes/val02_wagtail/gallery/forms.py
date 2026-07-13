from django import forms

from .models import (
    CandidateImage,
    Character,
    FigurePrototype,
    FigureVersion,
    Manufacturer,
    Work,
)


class CandidateReviewForm(forms.Form):
    ACTIONS = [
        ("defer", "Defer"),
        ("ignore", "Ignore"),
        ("create", "Create new prototype"),
        ("attach", "Attach to existing version"),
        ("accept_field", "Accept one field"),
        ("reject_field", "Reject one field"),
        ("select_main", "Select main image manually"),
    ]
    action = forms.ChoiceField(choices=ACTIONS)
    reason = forms.CharField(widget=forms.Textarea, required=True)
    target_version = forms.ModelChoiceField(
        queryset=FigureVersion.objects.none(), required=False
    )
    target_prototype = forms.ModelChoiceField(
        queryset=FigurePrototype.objects.none(), required=False
    )
    manufacturer = forms.ModelChoiceField(
        queryset=Manufacturer.objects.none(), required=False
    )
    work = forms.ModelChoiceField(queryset=Work.objects.none(), required=False)
    characters = forms.ModelMultipleChoiceField(
        queryset=Character.objects.none(), required=False
    )
    title = forms.CharField(required=False)
    figure_type = forms.ChoiceField(
        choices=FigurePrototype.FigureType.choices, required=False
    )
    scale = forms.CharField(required=False)
    field_name = forms.ChoiceField(
        choices=[("title", "Title"), ("scale", "Scale"), ("figure_type", "Figure type")],
        required=False,
    )
    candidate_image = forms.ModelChoiceField(
        queryset=CandidateImage.objects.none(), required=False
    )

    def __init__(self, *args, candidate=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["target_version"].queryset = FigureVersion.objects.select_related(
            "prototype"
        ).order_by("prototype__title", "name")
        self.fields["target_prototype"].queryset = FigurePrototype.objects.filter(
            is_soft_deleted=False, is_merged=False
        ).order_by("title")
        self.fields["manufacturer"].queryset = Manufacturer.objects.exclude(
            status=Manufacturer.Status.HIDDEN
        ).order_by("name")
        self.fields["work"].queryset = Work.objects.order_by("name")
        self.fields["characters"].queryset = Character.objects.filter(
            is_soft_deleted=False
        ).order_by("display_name", "work__name")
        if candidate is not None:
            self.fields["candidate_image"].queryset = candidate.images.select_related(
                "image"
            )

    def clean(self):
        cleaned = super().clean()
        action = cleaned.get("action")
        required = {
            "create": ["title", "manufacturer", "characters", "figure_type"],
            "attach": ["target_version"],
            "accept_field": ["target_prototype", "field_name"],
            "reject_field": ["field_name"],
            "select_main": ["target_prototype", "candidate_image"],
        }.get(action, [])
        for field in required:
            value = cleaned.get(field)
            if value is None or value == "" or (field == "characters" and not value.exists()):
                self.add_error(field, "This field is required for the selected action.")
        return cleaned
