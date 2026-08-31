from __future__ import annotations

import unittest
import sys
import json
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from source_registry import SOURCES, source_spec


class SourceRegistryTests(unittest.TestCase):
    def test_national_sources_have_distinct_provider_identities(self) -> None:
        required = {
            "tci_thaijo",
            "tci_citation",
            "tnrr",
            "thailis_tdc",
            "thai_conference",
            "thai_ir",
        }
        self.assertTrue(required.issubset(SOURCES))
        self.assertNotEqual(source_spec("tci_thaijo").provider, source_spec("tci_citation").provider)
        self.assertEqual(source_spec("tci_thaijo").label, "ThaiJO Journals")
        self.assertEqual(source_spec("tci_citation").label, "TCI Citation Index")

    def test_external_sources_default_to_non_evidence_ingestion(self) -> None:
        for provider in ("tci_thaijo", "tci_citation", "tnrr", "thailis_tdc", "thai_conference", "thai_ir"):
            with self.subTest(provider=provider):
                spec = source_spec(provider)
                self.assertNotEqual(spec.ingestion_mode, "local_full_text")
                self.assertIn(spec.default_rights_status, {"metadata_only_unverified", "restricted"})

    def test_unknown_provider_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown source provider"):
            source_spec("unreviewed_scraper")

    def test_machine_registry_uses_runtime_provider_ids(self) -> None:
        registry = json.loads((PIPELINE_DIR / "thai_research_provider_registry.json").read_text(encoding="utf-8"))
        provider_ids = {item["id"] for item in registry["providers"]}
        runtime_external_ids = {
            "tci_thaijo",
            "tci_citation",
            "tnrr",
            "thailis_tdc",
            "ncce",
            "thai_conference",
            "thai_ir",
        }
        self.assertTrue(runtime_external_ids.issubset(provider_ids))
        self.assertTrue(all(item["coverage_denominator"]["complete"] is False for item in registry["providers"]))


if __name__ == "__main__":
    unittest.main()
