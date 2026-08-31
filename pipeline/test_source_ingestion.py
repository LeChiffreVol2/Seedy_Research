from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from extract import markdown_from_pages  # noqa: E402
from harvest_tci_oai import (  # noqa: E402
    RIGHTS_ACTIONS,
    apply_endpoint_discipline,
    catalog_eligible_records,
    deduplicate_catalog_records,
    is_oai_tombstone,
    load_catalog_records,
    official_endpoint_registration,
    parse_list_records,
    parse_list_sets,
    preserve_reviewed_catalog_state,
    reviewed_source_scope,
    reviewed_source_sets,
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

    def test_tci_official_registry_requires_exact_endpoint_match(self) -> None:
        endpoint = "https://ph01.tci-thaijo.org/index.php/index/oai"
        registration = official_endpoint_registration(endpoint + "/")

        self.assertIsNotNone(registration)
        self.assertEqual(registration["endpoint_family"], "ph01")
        self.assertEqual(registration["discipline"], "physical_sciences")
        self.assertEqual(registration["registry_version"], 1)
        self.assertIsNone(official_endpoint_registration(endpoint + "/extra"))
        self.assertIsNone(official_endpoint_registration(endpoint + "?verb=Identify"))
        self.assertIsNone(
            official_endpoint_registration("https://ph01.tci-thaijo.org.evil.invalid/index.php/index/oai")
        )

    def test_tci_official_registry_covers_all_published_endpoint_families(self) -> None:
        payload = json.loads(
            (PIPELINE_DIR / "tci_official_endpoint_registry.json").read_text(encoding="utf-8")
        )
        families = {item["family"] for item in payload["endpoints"]}

        self.assertEqual(payload["version"], 1)
        self.assertEqual(len(payload["endpoints"]), 36)
        self.assertEqual(len(families), 36)
        self.assertEqual(
            families,
            {
                "sc01",
                *(f"li{index:02d}" for index in range(1, 6)),
                *(f"ph{index:02d}" for index in range(1, 6)),
                *(f"he{index:02d}" for index in range(1, 6)),
                *(f"so{index:02d}" for index in range(1, 21)),
            },
        )

    def test_tci_official_endpoint_domain_assignment_records_provenance(self) -> None:
        endpoint = "https://so20.tci-thaijo.org/index.php/index/oai"
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records(endpoint, fixture)
        registration = official_endpoint_registration(endpoint)
        self.assertIsNotNone(registration)
        prior_hash = records[0]["record_hash"]

        apply_endpoint_discipline(records[0], registration)

        self.assertEqual(records[0]["discipline"], "social_sciences")
        provenance = records[0]["raw_metadata"]["discipline_provenance"]
        self.assertEqual(provenance["policy"], "tci_thaijo_official_endpoint_registry_v1")
        self.assertEqual(provenance["match"], "exact_endpoint")
        self.assertEqual(
            provenance["registry_source_url"],
            "https://www.tci-thaijo.org/public/oai.html",
        )
        self.assertNotEqual(records[0]["record_hash"], prior_hash)

    def test_tci_unknown_endpoint_has_no_automatic_domain(self) -> None:
        endpoint = "https://example.invalid/oai"
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records(endpoint, fixture)

        self.assertIsNone(official_endpoint_registration(endpoint))
        self.assertEqual(records[0]["discipline"], "unknown")
        self.assertNotIn("discipline_provenance", records[0]["raw_metadata"])
        self.assertTrue(records[0]["rights_manifest"]["metadata_indexing"])
        self.assertFalse(records[0]["rights_manifest"]["full_text_download"])

    def test_tci_reviewed_batch_is_ordered_unique_and_keeps_general_engineering_explicit(self) -> None:
        endpoint = "https://ph01.tci-thaijo.org/index.php/index/oai"
        reviewed = reviewed_source_sets(endpoint)
        specs = [item["set_spec"] for item in reviewed]

        self.assertEqual(len(specs), len(set(specs)))
        self.assertEqual(specs[0], "SEAGS_AGSSEA_Journal:RP")
        self.assertIn("jsid:RS_ART", specs)
        self.assertEqual(
            next(item["scope"] for item in reviewed if item["set_spec"] == "EngJCMU:RES"),
            "unknown",
        )
        self.assertEqual(reviewed_source_sets("https://example.invalid/oai"), [])

    def test_tci_generated_catalog_can_resume_apply_without_reharvesting(self) -> None:
        endpoint = "https://ph01.tci-thaijo.org/index.php/index/oai"
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records(endpoint, fixture)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.jsonl"
            path.write_text(
                "".join(json.dumps(record) + "\n" for record in records),
                encoding="utf-8",
            )
            loaded = load_catalog_records(path, endpoint)

        self.assertEqual(
            [record["provider_record_id"] for record in loaded],
            [record["provider_record_id"] for record in records],
        )

    def test_tci_oai_deduplicates_identical_records_before_jsonl_and_apply(self) -> None:
        endpoint = "https://sc01.tci-thaijo.org/index.php/index/oai"
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records(endpoint, fixture)

        deduplicated = deduplicate_catalog_records([records[0], records[1], records[0]])

        self.assertEqual(
            [record["provider_record_id"] for record in deduplicated],
            [records[0]["provider_record_id"], records[1]["provider_record_id"]],
        )

    def test_tci_catalog_excludes_issue_containers_but_keeps_tombstones(self) -> None:
        endpoint = "https://sc01.tci-thaijo.org/index.php/index/oai"
        fixture = (PIPELINE_DIR / "fixtures" / "tci_oai_list_records.xml").read_bytes()
        records, _ = parse_list_records(endpoint, fixture)
        issue = json.loads(json.dumps(records[0]))
        issue["raw_metadata"]["titles"] = ["ฉบับเต็ม", "FULL ISSUE"]

        eligible = catalog_eligible_records([records[0], issue, records[1]])

        self.assertEqual(eligible, [records[0], records[1]])

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
