import json
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase


FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "val02_contract"
    / "fixtures"
    / "domain_fixture.json"
)


class SeededTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_synthetic", "--reset", verbosity=0)
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
