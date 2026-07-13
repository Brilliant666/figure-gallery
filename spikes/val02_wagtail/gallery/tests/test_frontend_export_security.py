import json
from pathlib import Path
import tempfile

import requests
from django.contrib.auth import get_user_model
from django.test import override_settings

from gallery.exports import build_export_bundle, write_csv_export, write_json_export
from gallery.models import CandidateImage, Character, FigurePrototype, Manufacturer, SystemSetting
from gallery.network_guard import HpoiNetworkBlocked
from gallery.services import select_main_image, update_system_settings

from .base import SeededTestCase


class FrontendTests(SeededTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.reviewer = get_user_model().objects.get(username="fixture-admin")

    def test_unique_alias_match_redirects_to_gallery(self):
        response = self.client.get("/search/", {"q": "Pilot Lin"})
        self.assertEqual(response.status_code, 302)
        self.assertIn("/characters/", response["Location"])

    def test_same_name_characters_render_work_disambiguation(self):
        response = self.client.get("/search/", {"q": "林"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "星轨纪事")
        self.assertContains(response, "月庭物语")

    def test_multi_character_prototype_is_queryable_from_each_character(self):
        group = FigurePrototype.objects.get(is_multi_character=True)
        source_image = CandidateImage.objects.filter(
            prototype__main_image__isnull=False,
            image__isnull=False,
        ).first()
        group_image = CandidateImage.objects.create(
            prototype=group,
            image=source_image.image,
            storage_key="synthetic/group/server-render-main.png",
            original_url="https://synthetic.invalid/group/server-render-main.png",
            file_size=source_image.file_size,
            width=source_image.width,
            height=source_image.height,
            format=source_image.format,
            sha256=source_image.sha256,
            perceptual_hash=source_image.perceptual_hash,
        )
        select_main_image(
            group.pk,
            group_image.pk,
            reason="Synthetic multi-character server-render test",
            actor=self.reviewer,
        )
        character_ids = [character.pk for character in group.characters.all()]
        self.assertGreaterEqual(len(character_ids), 2)
        for character_id in character_ids:
            response = self.client.get(f"/characters/{character_id}/")
            self.assertEqual(response.status_code, 200)
            self.assertIn(
                group.pk,
                [card["prototype"].pk for card in response.context["cards"]],
            )

    def test_similar_pose_different_manufacturers_remain_distinct(self):
        scenario = self.fixture["scenarios"]["similar_pose_distinct_prototype_ids"]
        # Seed order follows the stable fixture order.
        items = list(FigurePrototype.objects.order_by("pk")[:2])
        self.assertEqual(len(items), len(scenario))
        self.assertNotEqual(items[0].manufacturer_id, items[1].manufacturer_id)
        self.assertNotEqual(items[0].pk, items[1].pk)
        character = items[0].characters.get()
        self.assertTrue(items[1].characters.filter(pk=character.pk).exists())
        source_image = CandidateImage.objects.get(
            prototype=items[0], selected_as_main=True
        )
        second_main = CandidateImage.objects.create(
            prototype=items[1],
            image=source_image.image,
            storage_key="synthetic/similar-pose/second-public-main.png",
            original_url="https://synthetic.invalid/similar-pose/second-public-main.png",
            file_size=source_image.file_size,
            width=source_image.width,
            height=source_image.height,
            format=source_image.format,
            sha256=source_image.sha256,
            perceptual_hash=source_image.perceptual_hash,
        )
        select_main_image(
            items[1].pk,
            second_main.pk,
            reason="Synthetic public-query proof for distinct similar poses",
            actor=self.reviewer,
        )
        response = self.client.get(f"/characters/{character.pk}/")
        rendered_ids = [card["prototype"].pk for card in response.context["cards"]]
        self.assertEqual(rendered_ids.count(items[0].pk), 1)
        self.assertEqual(rendered_ids.count(items[1].pk), 1)

    def test_four_versions_are_one_gallery_prototype(self):
        prototype = FigurePrototype.objects.annotate().filter(versions__kind="deluxe").distinct().get()
        self.assertEqual(prototype.versions.count(), 4)
        self.assertEqual(
            FigurePrototype.objects.filter(versions__in=prototype.versions.all()).distinct().count(),
            1,
        )
        character = prototype.characters.get()
        response = self.client.get(f"/characters/{character.pk}/")
        rendered_ids = [card["prototype"].pk for card in response.context["cards"]]
        self.assertEqual(rendered_ids.count(prototype.pk), 1)

    def _attach_adult_main(self):
        adult = CandidateImage.objects.filter(is_adult=True, image__isnull=False).get()
        prototype = adult.candidate.target_prototype
        adult.prototype = prototype
        adult.save(update_fields=["prototype", "updated_at"])
        select_main_image(
            prototype.pk,
            adult.pk,
            reason="Synthetic adult visibility test",
            actor=self.reviewer,
        )
        return prototype

    def test_adult_main_is_hidden_by_default_and_visible_when_enabled(self):
        prototype = self._attach_adult_main()
        character = prototype.characters.first()
        config = SystemSetting.load()
        self.assertFalse(config.show_adult_images)
        hidden = self.client.get(f"/characters/{character.pk}/")
        self.assertNotIn(prototype.pk, [card["prototype"].pk for card in hidden.context["cards"]])
        update_system_settings(
            show_adult_images=True,
            reason="Reviewer enabled synthetic adult-image visibility",
            actor=self.reviewer,
        )
        visible = self.client.get(f"/characters/{character.pk}/")
        self.assertIn(prototype.pk, [card["prototype"].pk for card in visible.context["cards"]])

    def test_stale_source_does_not_unpublish_or_remove_local_main(self):
        # It is the sole prototype whose formal source is unavailable in the fixture.
        prototype = FigurePrototype.objects.filter(sources__is_unavailable=True).get()
        source = prototype.sources.get(is_unavailable=True)
        main_record = CandidateImage.objects.get(
            prototype=prototype,
            selected_as_main=True,
            image_id=prototype.main_image_id,
        )
        storage_key_before = main_record.storage_key
        main_image_before = prototype.main_image_id
        self.assertTrue(storage_key_before)
        source.source_url = "https://synthetic.invalid/source-now-removed"
        source.is_unavailable = True
        source.save(update_fields=["source_url", "is_unavailable", "updated_at"])
        prototype.refresh_from_db()
        main_record.refresh_from_db()
        self.assertTrue(prototype.live)
        self.assertEqual(prototype.main_image_id, main_image_before)
        self.assertEqual(main_record.storage_key, storage_key_before)
        self.assertTrue(prototype.main_image.file.storage.exists(prototype.main_image.file.name))

    def test_default_page_size_and_stable_paginator(self):
        config = SystemSetting.load()
        self.assertEqual(config.page_size, 16)
        character = Character.objects.first()
        existing = FigurePrototype.objects.filter(
            characters=character,
            live=True,
            is_hidden=False,
            is_soft_deleted=False,
            is_merged=False,
            manufacturer__status=Manufacturer.Status.ACTIVE,
            main_image__isnull=False,
        ).distinct().count()
        template = FigurePrototype.objects.exclude(main_image=None).first()
        for index in range(max(0, 17 - existing)):
            prototype = FigurePrototype.objects.create(
                title=f"Synthetic pagination prototype {index:02d}",
                work=character.work,
                manufacturer=template.manufacturer,
                figure_type=FigurePrototype.FigureType.SCALE,
                scale="1/10",
                live=True,
                main_image=template.main_image,
            )
            prototype.characters.set([character])
            prototype.save()
        first = self.client.get(f"/characters/{character.pk}/", {"page": 1})
        second = self.client.get(f"/characters/{character.pk}/", {"page": 2})
        first_ids = [card["prototype"].pk for card in first.context["cards"]]
        second_ids = [card["prototype"].pk for card in second.context["cards"]]
        self.assertEqual(first.context["page"].paginator.per_page, 16)
        self.assertEqual(len(first_ids), 16)
        self.assertEqual(len(second_ids), 1)
        self.assertTrue(set(first_ids).isdisjoint(second_ids))
        self.assertEqual(first_ids + second_ids, sorted(first_ids + second_ids))

    def test_original_ratio_dom_and_css_contract(self):
        static_dir = Path(__file__).resolve().parents[1] / "static" / "gallery"
        css = (static_dir / "gallery.css").read_text(encoding="utf-8")
        template = (
            Path(__file__).resolve().parents[1]
            / "templates"
            / "gallery"
            / "character_gallery.html"
        ).read_text(encoding="utf-8")
        self.assertIn("repeat(4", css)
        self.assertIn("repeat(3", css)
        self.assertIn("repeat(2", css)
        self.assertIn("object-fit: contain", css)
        self.assertIn('width="{{ card.width }}"', template)
        self.assertIn('height="{{ card.height }}"', template)

    def test_lightbox_current_page_static_contract(self):
        static_dir = Path(__file__).resolve().parents[1] / "static" / "gallery"
        script = (static_dir / "gallery.js").read_text(encoding="utf-8")
        template = (
            Path(__file__).resolve().parents[1]
            / "templates"
            / "gallery"
            / "character_gallery.html"
        ).read_text(encoding="utf-8")
        self.assertIn("cards.length", script)
        self.assertIn('document.querySelectorAll("[data-gallery] [data-src]")', script)
        self.assertIn("data-prev", template)
        self.assertIn("data-next", template)
        self.assertIn("data-zoom", template)
        self.assertNotIn("download", template.lower())


class ExportAndSecurityTests(SeededTestCase):
    def test_json_export_has_relations_media_metadata_and_no_binary(self):
        bundle = build_export_bundle()
        self.assertFalse(bundle["contains_binary_media"])
        prototype = bundle["figure_prototypes"][0]
        image = bundle["candidate_images"][0]
        self.assertIn("character_ids", prototype)
        self.assertIn("manufacturer_id", prototype)
        self.assertIn("storage_key", image)
        self.assertIn("original_url", image)
        self.assertIn("sha256", image)
        serialized = json.dumps(bundle)
        self.assertNotIn("data:image", serialized)
        self.assertNotIn("content_base64", serialized)

    def test_json_and_csv_exports_parse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            json_path = root / "export.json"
            write_json_export(json_path)
            parsed = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(parsed["schema_version"], 1)
            prototype = parsed["figure_prototypes"][0]
            source = parsed["source_records"][0]
            image = parsed["candidate_images"][0]
            self.assertTrue(
                {"id", "character_ids", "work_id", "manufacturer_id", "main_image_id"}
                <= set(prototype)
            )
            self.assertTrue({"id", "prototype_id", "source_url"} <= set(source))
            self.assertTrue(
                {
                    "id",
                    "candidate_id",
                    "prototype_id",
                    "media_id",
                    "storage_key",
                    "original_url",
                    "sha256",
                }
                <= set(image)
            )
            files = write_csv_export(root / "csv")
            manifest = json.loads((root / "csv" / "manifest.json").read_text(encoding="utf-8"))
            self.assertGreater(len(files), 5)
            self.assertFalse(manifest["contains_binary_media"])

    def test_hpoi_guard_and_static_runtime_scan(self):
        for url in ("https://hpoi.net/", "https://www.hpoi.net/", "https://rfx.hpoi.net/image"):
            with self.subTest(url=url), self.assertRaises(HpoiNetworkBlocked):
                requests.get(url, timeout=0.01)
        app_root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in app_root.rglob("*.py"):
            if "tests" in path.parts or path.name == "network_guard.py":
                continue
            text = path.read_text(encoding="utf-8").lower()
            if "hpoi.net" in text or "rfx.hpoi" in text:
                offenders.append(str(path))
        self.assertEqual(offenders, [])
