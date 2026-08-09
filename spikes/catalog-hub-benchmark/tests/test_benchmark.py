import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "spikes" / "catalog-hub-benchmark" / "benchmark.py"
SPEC = importlib.util.spec_from_file_location("catalog_hub_benchmark", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BenchmarkTests(unittest.TestCase):
    def load_observations(self):
        path = ROOT / "spikes" / "catalog-hub-benchmark" / "observations.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def load_audit(self):
        path = (
            ROOT
            / "research"
            / "evidence"
            / "catalog-hub-discovery"
            / "goodsmile-audit.json"
        )
        return json.loads(path.read_text(encoding="utf-8"))

    def test_derives_good_smile_coverage(self):
        result = MODULE.build_results(self.load_observations(), self.load_audit())
        coverage = result["goodSmile"]["coverage"]
        self.assertEqual(coverage["unionPrototypes"], 30)
        self.assertEqual(coverage["marginalPrototypeCandidates"], 19)
        self.assertEqual(coverage["directSeedFraction"], 0.0976)

    def test_derives_media_metrics(self):
        result = MODULE.build_results(self.load_observations(), self.load_audit())
        media = result["goodSmile"]["media"]
        self.assertEqual(media["meanUrlsPerRecord"], 7.95)
        self.assertEqual(media["sampleFullFigureRate"], 0.5)

    def test_blocked_sources_do_not_claim_products(self):
        result = MODULE.build_results(self.load_observations(), self.load_audit())
        blocked = [
            row
            for row in result["liveBenchmarks"]
            if row["status"] not in {"completed", "completed_limited"}
        ]
        self.assertTrue(blocked)
        self.assertTrue(all(row["rawProducts"] is None for row in blocked))

    def test_myfigurelist_marginal_rate_is_scoped_to_rem_sample(self):
        result = MODULE.build_results(self.load_observations(), self.load_audit())
        row = next(row for row in result["liveBenchmarks"] if row["source"] == "MyFigureList")
        self.assertEqual(row["marginalCandidates"], 9)
        self.assertEqual(row["marginalCandidatesPerRequest"], 1.5)

    def test_per_record_audit_drives_scope_and_identity_counts(self):
        result = MODULE.build_results(self.load_observations(), self.load_audit())
        coverage = result["goodSmile"]["coverage"]
        self.assertEqual(coverage["inScopeRecords"], 33)
        self.assertEqual(coverage["probableUniquePrototypesAll"], 35)
        self.assertEqual(coverage["probableUniquePrototypesInScope"], 27)
        self.assertEqual(coverage["intersectionPrototypes"], 8)


if __name__ == "__main__":
    unittest.main()
