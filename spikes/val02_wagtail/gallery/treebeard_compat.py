"""Fail-closed guard for the Treebeard version Wagtail 7.4.2 was tested with."""

from importlib.metadata import version

from django.core.exceptions import ImproperlyConfigured


VALIDATED_TREEBEARD_VERSION = "5.3.0"


def enforce_validated_treebeard_version():
    installed = version("django-treebeard")
    if installed != VALIDATED_TREEBEARD_VERSION:
        raise ImproperlyConfigured(
            "This disposable Wagtail spike validated django-treebeard "
            f"{VALIDATED_TREEBEARD_VERSION}, but {installed} is installed. Re-run the "
            "manager, workflow, migration and system-check gates before upgrading."
        )
    return installed
