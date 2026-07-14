from django.urls import path

from . import views


app_name = "gallery"

urlpatterns = [
    path("", views.home, name="home"),
    path("search/", views.character_search, name="character_search"),
    path("characters/<int:character_id>/", views.character_gallery, name="character_gallery"),
    path("api/val02/candidates/upsert/", views.candidate_upsert_api, name="candidate_upsert"),
]
