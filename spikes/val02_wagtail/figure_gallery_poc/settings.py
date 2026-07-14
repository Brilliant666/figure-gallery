"""Settings for an offline, disposable Wagtail/Django comparison prototype."""

from pathlib import Path
import os
import secrets
import tempfile


BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or secrets.token_urlsafe(48)
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]

INSTALLED_APPS = [
    "gallery.apps.GalleryConfig",
    "wagtail.contrib.forms",
    "wagtail.contrib.redirects",
    "wagtail.embeds",
    "wagtail.sites",
    "wagtail.users",
    "wagtail.snippets",
    "wagtail.documents",
    "wagtail.images",
    "wagtail.search",
    "wagtail.admin",
    "wagtail",
    "modelcluster",
    "taggit",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "wagtail.contrib.redirects.middleware.RedirectMiddleware",
]

ROOT_URLCONF = "figure_gallery_poc.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]
WSGI_APPLICATION = "figure_gallery_poc.wsgi.application"

RUNTIME_DIR = Path(
    os.getenv(
        "VAL02_WAGTAIL_RUNTIME_DIR",
        Path(tempfile.gettempdir()) / "figure-gallery-val02-wagtail",
    )
)
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": RUNTIME_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = str(RUNTIME_DIR / "staticfiles")
MEDIA_URL = "/media/"
MEDIA_ROOT = str(RUNTIME_DIR / "media")

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": str(MEDIA_ROOT), "base_url": MEDIA_URL},
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# The S3-compatible boundary is opt-in and was validated without performing an
# object-store operation. Both backends expose Django's Storage API, so model
# fields and media identity remain unchanged.
S3_STORAGE_BOUNDARY = {
    "enabled": os.getenv("USE_S3_STORAGE", "false").lower() == "true",
    "bucket_env": "AWS_STORAGE_BUCKET_NAME",
    "endpoint_env": "AWS_S3_ENDPOINT_URL",
}
if S3_STORAGE_BOUNDARY["enabled"]:
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": os.getenv("AWS_STORAGE_BUCKET_NAME", ""),
            "endpoint_url": os.getenv("AWS_S3_ENDPOINT_URL") or None,
            "access_key": os.getenv("AWS_ACCESS_KEY_ID") or None,
            "secret_key": os.getenv("AWS_SECRET_ACCESS_KEY") or None,
            "default_acl": None,
            "querystring_auth": True,
        },
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
WAGTAIL_SITE_NAME = "Figure Gallery VAL-02 (disposable)"
WAGTAILADMIN_BASE_URL = "http://127.0.0.1:8000"
WAGTAIL_WORKFLOW_ENABLED = True
# Keep the disposable admin fully offline; Wagtail otherwise renders a remote
# Gravatar URL and checks releases.wagtail.org for updates.
WAGTAIL_GRAVATAR_PROVIDER_URL = None
WAGTAIL_ENABLE_UPDATE_CHECK = False

CANDIDATE_API_KEY = os.getenv(
    "VAL02_WAGTAIL_CANDIDATE_TOKEN", os.getenv("CANDIDATE_API_KEY", "")
)
VAL02_BLOCK_HPOI = os.getenv("VAL02_BLOCK_HPOI", "true").lower() == "true"
