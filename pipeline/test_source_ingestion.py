from __future__ import annotations

import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from extract import markdown_from_pages  # noqa: E402
from harvest_tci_oai import (  # noqa: E402
    RIGHTS_ACTIONS,
    is_oai_tombstone,
    parse_list_records,
    parse_list_sets,
    preserve_reviewed_catalog_state,
    reviewed_source_scope,
    sanitize_xml_payload,
    tombstone_catalog_update,
)


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

    def test_tci_oai_keeps_deleted_headers_as_non_citable_tombstones(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, token = parse_list_records("https://example.invalid/oai", fixture)
        self.assertEqual(len(records), 2)
        self.assertEqual(token, "next-page-token")
        self.assertEqual(records[0]["collection"], "tci_journal")
        self.assertEqual(records[0]["evidence_status"], "metadata_only")
        self.assertEqual(records[0]["title_en"], "Road Safety Assessment")
        self.assertEqual(records[0]["doi"], "10.1234/example.42")

        tombstone = records[1]
        self.assertTrue(is_oai_tombstone(tombstone))
        self.assertEqual(
            tombstone["provider_record_id"],
            "oai:example.invalid:article/deleted",
        )
        self.assertEqual(tombstone["rights_status"], "removed")
        self.assertEqual(tombstone["evidence_status"], "removed")
        self.assertEqual(tombstone["source_updated_at"], "2026-07-21")
        self.assertIsNone(tombstone["document_id"])

    def test_tci_oai_tombstone_is_default_deny_except_header_indexing(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records("https://example.invalid/oai", fixture)
        tombstone = records[1]

        self.assertTrue(tombstone["rights_manifest"]["metadata_indexing"])
        for action in set(RIGHTS_ACTIONS) - {"metadata_indexing"}:
            self.assertFalse(tombstone["rights_manifest"][action], action)
        self.assertEqual(
            tombstone["rights_provenance"]["policy"],
            "tci_thaijo_oai_deleted_v1",
        )
        self.assertEqual(
            tombstone["rights_provenance"]["source_deleted_at"],
            "2026-07-21",
        )

    def test_tombstone_update_preserves_reviewed_state_and_is_idempotent(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records("https://example.invalid/oai", fixture)
        tombstone = records[1]
        existing = {
            "record_hash": "prior-metadata-hash",
            "raw_metadata": {
                "titles": ["Reviewed title"],
                "rights": ["Permission granted by publisher"],
            },
            "rights_status": "permission_granted",
            "rights_manifest": {"full_text_embedding": True},
            "rights_provenance": {"policy": "human_review_v1"},
            "rights_verified_at": "2026-08-02T00:00:00+00:00",
            "access_level": "full_text_licensed",
            "evidence_status": "indexed",
            "document_id": "verified-document-id",
        }

        update = tombstone_catalog_update(tombstone, existing)
        self.assertEqual(update["evidence_status"], "removed")
        self.assertEqual(update["raw_metadata"]["titles"], ["Reviewed title"])
        self.assertEqual(
            update["raw_metadata"]["oai_tombstone"]["prior_record_hash"],
            "prior-metadata-hash",
        )
        for preserved_field in (
            "rights_status",
            "rights_manifest",
            "rights_provenance",
            "rights_verified_at",
            "access_level",
            "document_id",
        ):
            self.assertNotIn(preserved_field, update)

        already_applied = {**existing, **update}
        self.assertEqual(
            tombstone_catalog_update(tombstone, already_applied),
            update,
        )

    def test_tci_oai_rights_are_metadata_only_and_default_deny(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records("https://example.invalid/oai", fixture)
        record = records[0]
        manifest = record["rights_manifest"]

        self.assertEqual(set(manifest), set(RIGHTS_ACTIONS))
        self.assertTrue(manifest["metadata_indexing"])
        self.assertTrue(manifest["abstract_storage"])
        for action in set(RIGHTS_ACTIONS) - {"metadata_indexing", "abstract_storage"}:
            self.assertFalse(manifest[action], action)
        self.assertEqual(record["rights_manifest_version"], 1)
        self.assertEqual(record["rights_status"], "metadata_only_unverified")
        self.assertIsNone(record["rights_verified_at"])
        self.assertEqual(record["rights_checked_at"], record["updated_at"])

    def test_declared_open_license_never_promotes_tci_evidence_or_processing_rights(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records("https://example.invalid/oai", fixture)
        record = records[0]

        self.assertEqual(record["license"], "CC BY 4.0")
        self.assertEqual(record["evidence_status"], "metadata_only")
        self.assertIsNone(record["document_id"])
        self.assertFalse(record["rights_manifest"]["full_text_download"])
        self.assertFalse(record["rights_manifest"]["full_text_embedding"])
        self.assertFalse(record["rights_manifest"]["commercial_use"])
        self.assertFalse(record["rights_manifest"]["model_training"])
        self.assertFalse(record["rights_provenance"]["automated_rights_inference"])
        self.assertEqual(record["rights_provenance"]["declared_rights"], ["CC BY 4.0"])

    def test_reharvest_preserves_reviewed_rights_and_evidence_promotion(self) -> None:
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records("https://example.invalid/oai", fixture)
        incoming = records[0]
        existing = {
            "rights_status": "permission_granted",
            "rights_manifest_version": 1,
            "rights_manifest": {**incoming["rights_manifest"], "full_text_embedding": True},
            "rights_provenance": {"policy": "human_review_v1", "reviewer": "rights-team"},
            "rights_checked_at": "2026-08-01T00:00:00+00:00",
            "rights_verified_at": "2026-08-02T00:00:00+00:00",
            "access_level": "full_text_licensed",
            "evidence_status": "indexed",
            "document_id": "verified-document-id",
        }

        merged = preserve_reviewed_catalog_state(incoming, existing)
        for field, value in existing.items():
            self.assertEqual(merged[field], value, field)
        self.assertEqual(merged["title_en"], incoming["title_en"])
        self.assertEqual(merged["raw_metadata"], incoming["raw_metadata"])

    def test_tci_oai_lists_journal_sets(self) -> None:
        payload = b"""<?xml version="1.0"?>
        <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
          <ListSets><set><setSpec>civil</setSpec><setName>Civil Engineering Journal</setName></set></ListSets>
        </OAI-PMH>"""
        self.assertEqual(parse_list_sets(payload), [("civil", "Civil Engineering Journal")])

    def test_tci_allowlist_requires_exact_endpoint_and_set(self) -> None:
        endpoint = "https://ph01.tci-thaijo.org/index.php/index/oai"
        self.assertEqual(
            reviewed_source_scope(endpoint, "SEAGS_AGSSEA_Journal:RP"),
            "geotechnical",
        )
        self.assertEqual(reviewed_source_scope(endpoint + "/", "html:RP"), "structural")
        self.assertIsNone(reviewed_source_scope(endpoint, "unreviewed:set"))
        self.assertIsNone(
            reviewed_source_scope("https://example.invalid/oai", "SEAGS_AGSSEA_Journal:RP")
        )

    def test_tci_oai_sanitizes_invalid_xml_control_bytes(self) -> None:
        payload = b"<root><abstract>factor (\xce\xb1\x01) and (\x02\xce\xb2)</abstract></root>"
        cleaned = sanitize_xml_payload(payload)
        self.assertNotIn(b"\x01", cleaned)
        self.assertNotIn(b"\x02", cleaned)
        self.assertIn("factor (α) and (β)", cleaned.decode("utf-8"))

    def test_tci_oai_treats_no_records_match_as_an_empty_set(self) -> None:
        payload = b'''<?xml version="1.0"?>
        <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
          <error code="noRecordsMatch">No matching records</error>
        </OAI-PMH>'''
        self.assertEqual(parse_list_records("https://example.invalid/oai", payload), ([], None))


if __name__ == "__main__":
    unittest.main()
