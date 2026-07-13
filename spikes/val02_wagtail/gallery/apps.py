from django.apps import AppConfig


class GalleryConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "gallery"

    def ready(self):
        from django.conf import settings

        if settings.VAL02_BLOCK_HPOI:
            from .network_guard import install_hpoi_guard

            install_hpoi_guard()
