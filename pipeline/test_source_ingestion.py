from __future__ import annotations

import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from extract import markdown_from_pages  # noqa: E402
from harvest_tci_oai import parse_list_records, parse_list_sets  # noqa: E402


class SourceIngestionTests(unittest.TestCase):
    def test_page_numbers_survive_empty_pages(self) -> None:
        markdown = markdown_from_pages(
            Path("Y2024_TR_Article_G99.pdf"),
            ["first", "", "third"],
            "test",
        )
        self.assertIn("page_end: 3", markdown)
        self.assertIn("## Page 1", markdown)
        self.assertNotIn("## Page 2", markdown)
        self.assertIn("## Page 3", markdown)

    def test_tci_oai_is_metadata_only_and_skips_deleted_records(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, token = parse_list_records("https://example.invalid/oai", fixture)
        self.assertEqual(len(records), 1)
        self.assertEqual(token, "next-page-token")
        self.assertEqual(records[0]["collection"], "tci_journal")
        self.assertEqual(records[0]["evidence_status"], "metadata_only")
        self.assertEqual(records[0]["title_en"], "Road Safety Assessment")
        self.assertEqual(records[0]["doi"], "10.1234/example.42")

    def test_tci_oai_lists_journal_sets(self) -> None:
        payload = b"""<?xml version="1.0"?>
        <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
          <ListSets><set><setSpec>civil</setSpec><setName>Civil Engineering Journal</setName></set></ListSets>
        </OAI-PMH>"""
        self.assertEqual(parse_list_sets(payload), [("civil", "Civil Engineering Journal")])


if __name__ == "__main__":
    unittest.main()
