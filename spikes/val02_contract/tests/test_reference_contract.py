from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


CONTRACT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CONTRACT_DIR))

from fixture_contract import load_fixture  # noqa: E402
from reference_contract import ReferenceCandidatePool, normalize_source_url, source_identity  # noqa: E402


class ReferenceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture()
        self.pool = ReferenceCandidatePool.from_fixture(self.fixture)

    def test_url_normalization_removes_tracking_fragment_and_sorts_query(self) -> None:
        normalized = normalize_source_url(
            "HTTPS://SYNTHETIC.INVALID:443/a/../item/?z=2&utm_source=test&a=1#fragment"
        )
        self.assertEqual(normalized, "https://synthetic.invalid/item/?a=1&z=2")

    def test_stable_id_takes_priority_over_url(self) -> None:
        source = {
            "source_type": "synthetic_feed",
            "source_item_id": "ABC",
            "source_url": "https://synthetic.invalid/items/ignored-for-key",
        }
        self.assertEqual(source_identity(source), ("synthetic_feed", "id:ABC"))

    def test_first_and_duplicate_upsert_are_new_then_unchanged(self) -> None:
        candidate = self.fixture["candidate_records"][0]
        self.assertEqual(self.pool.upsert_candidate(candidate).outcome, "new")
        self.assertEqual(self.pool.upsert_candidate(candidate).outcome, "unchanged")
        self.assertEqual(len(self.pool.candidates), 1)

    def test_changed_candidate_is_updated_without_duplicate(self) -> None:
        candidate = self.fixture["candidate_records"][0]
        self.pool.upsert_candidate(candidate)
        changed = copy.deepcopy(candidate)
        changed["raw_date"] = "2027-01"
        self.assertEqual(self.pool.upsert_candidate(changed).outcome, "updated")
        self.assertEqual(len(self.pool.candidates), 1)

    def test_url_fallback_migrates_to_later_stable_id(self) -> None:
        scenario = self.fixture["scenarios"]["url_fallback_migration"]
        candidate = copy.deepcopy(self.fixture["candidate_records"][0])
        candidate["source"] = {
            "source_type": scenario["source_type"],
            "source_item_id": None,
            "source_url": scenario["initial_url"],
        }
        first = self.pool.upsert_candidate(candidate)
        self.assertTrue(first.identity[1].startswith("url:"))
        candidate["source"]["source_item_id"] = scenario["later_source_item_id"]
        second = self.pool.upsert_candidate(candidate)
        self.assertIn(second.outcome, {"migrated", "migrated_updated"})
        self.assertEqual(second.previous_identity, first.identity)
        self.assertEqual(len(self.pool.sources), 1)
        self.assertEqual(len(self.pool.candidates), 1)

    def test_candidate_main_image_proposal_does_not_mutate_formal_state(self) -> None:
        before = self.pool.formal_snapshot()
        attack_id = self.fixture["scenarios"]["protected_main_image_candidate_id"]
        attack = next(row for row in self.fixture["candidate_records"] if row["id"] == attack_id)
        self.pool.upsert_candidate(attack)
        self.assertEqual(self.pool.formal_snapshot(), before)

    def test_unknown_character_and_manufacturer_remain_raw_candidate_values(self) -> None:
        before = self.pool.formal_snapshot()
        candidate = self.fixture["candidate_records"][0]
        self.assertEqual(candidate["match_state"], "character_pending")
        self.assertEqual(candidate["proposed_manufacturer_status"], "draft")
        self.pool.upsert_candidate(candidate)
        self.assertEqual(self.pool.formal_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
