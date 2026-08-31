from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from harvest_tnrr import (  # noqa: E402
    RIGHTS_ACTIONS,
    TNRR_RESEARCH_OUTPUT_ENDPOINT,
    build_query_params,
    canonical_record,
    harvest_pages,
    validate_catalog_record,
    write_jsonl,
)


SEEN_AT = "2026-08-31T00:00:00+00:00"


def sample_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "bibid": 290743,
        "title": "การศึกษาความปลอดภัยทางถนน",
        "author": "สมชาย ใจดี",
        "coAuthor": "สมหญิง วิจัย",
        "department": "มหาวิทยาลัยตัวอย่าง",
        "year": "2566",
        "doi": "https://doi.org/10.1234/TNRR.42",
        "docType": "บทความวิจัย",
        "abstractTH": "เนื้อหาบทคัดย่อที่ห้ามจัดเก็บ",
        "abstractEN": "Secret abstract content that must not be stored",
        "oECD1": "Engineering and technology",
        "oECD2": "Civil engineering",
        "linkPublic": "https://tnrr.nriis.go.th/research/290743#record",
        "createdate": "20230701",
        "updateDate": "2026-08-30T10:00:00+07:00",
        "hasfullReport": "true",
        "authorTeam": [
            {"bibid": 290743, "authorName": "สมชาย ใจดี", "positionAuthor": "ผู้แต่ง"},
            {"bibid": 290743, "authorName": "สมหญิง วิจัย", "positionAuthor": "ผู้แต่งร่วม"},
        ],
    }
    row.update(overrides)
    return row


class TnrrHarvesterTests(unittest.TestCase):
    def test_maps_official_research_output_without_abstract_or_report_content(self) -> None:
        record = canonical_record(sample_row(), seen_at=SEEN_AT)

        self.assertEqual(record["provider"], "tnrr")
        self.assertEqual(record["collection"], "tnrr_output")
        self.assertEqual(record["provider_record_id"], "290743")
        self.assertEqual(
            record["id"],
            canonical_record(sample_row(), seen_at="2027-01-01T00:00:00+00:00")["id"],
        )
        self.assertEqual(record["title_local"], "การศึกษาความปลอดภัยทางถนน")
        self.assertIsNone(record["title_en"])
        self.assertEqual(record["authors"], ["สมชาย ใจดี", "สมหญิง วิจัย"])
        self.assertEqual(record["doi"], "10.1234/tnrr.42")
        self.assertEqual(
            record["canonical_url"],
            "https://tnrr.nriis.go.th/research/290743",
        )
        self.assertEqual(record["published_at"], "2023-01-01")
        self.assertEqual(record["raw_metadata"]["year"], 2023)
        self.assertEqual(
            record["raw_metadata"]["oecd"],
            {"level_1": "Engineering and technology", "level_2": "Civil engineering"},
        )
        self.assertEqual(record["raw_metadata"]["doc_type"], "บทความวิจัย")
        self.assertTrue(record["raw_metadata"]["has_full_report_declared"])
        self.assertTrue(record["raw_metadata"]["abstract_local_present"])
        self.assertTrue(record["raw_metadata"]["abstract_en_present"])
        self.assertIsNone(record["abstract_local"])
        self.assertIsNone(record["abstract_en"])
        self.assertIsNone(record["pdf_url"])
        self.assertEqual(record["source_updated_at"], "2026-08-30T03:00:00+00:00")

    def test_has_full_report_never_promotes_fail_closed_rights(self) -> None:
        record = canonical_record(sample_row(hasfullReport=True), seen_at=SEEN_AT)
        manifest = record["rights_manifest"]

        self.assertEqual(set(manifest), set(RIGHTS_ACTIONS))
        self.assertTrue(manifest["metadata_indexing"])
        for action in set(RIGHTS_ACTIONS) - {"metadata_indexing"}:
            self.assertFalse(manifest[action], action)
        self.assertEqual(record["rights_status"], "metadata_only_unverified")
        self.assertEqual(record["access_level"], "metadata_only")
        self.assertEqual(record["evidence_status"], "metadata_only")
        self.assertIsNone(record["rights_verified_at"])
        self.assertFalse(
            record["rights_provenance"]["has_full_report_is_permission"]
        )

    def test_jsonl_contains_neither_abstracts_nor_bearer_secret(self) -> None:
        bearer_secret = "TNRR-BEARER-TOKEN-MUST-NEVER-LEAK"
        rows = {
            1: [sample_row()],
            2: [],
        }

        def fetch_page(params: dict[str, str]) -> object:
            # The bearer token belongs to the request layer, never the output.
            self.assertTrue(bearer_secret)
            return rows[int(params["page"])]

        records = harvest_pages(
            fetch_page,
            {"updatefrom": "20260801"},
            max_pages=2,
            delay_seconds=0,
            seen_at=SEEN_AT,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "tnrr.jsonl"
            write_jsonl(records, output)
            serialized = output.read_text(encoding="utf-8")

        self.assertNotIn(bearer_secret, serialized)
        self.assertNotIn("เนื้อหาบทคัดย่อที่ห้ามจัดเก็บ", serialized)
        self.assertNotIn("Secret abstract content", serialized)
        self.assertNotIn("abstractTH", serialized)
        self.assertNotIn("abstractEN", serialized)
        self.assertNotIn("loginPassword", Path(__file__).with_name("harvest_tnrr.py").read_text(encoding="utf-8"))
        self.assertNotIn("/authenticate", Path(__file__).with_name("harvest_tnrr.py").read_text(encoding="utf-8"))

    def test_pagination_passes_incremental_params_and_deduplicates_by_bibid(self) -> None:
        pages = {
            1: [
                sample_row(title="ชื่อเดิม", updateDate="2026-08-01"),
                sample_row(bibid=7, title="อีกเรื่อง", updateDate="2026-08-01"),
            ],
            2: [
                sample_row(title="ชื่อที่ปรับปรุง", updateDate="2026-08-02"),
                sample_row(bibid=7, title="อีกเรื่อง", updateDate="2026-08-01"),
            ],
            3: [],
        }
        calls: list[dict[str, str]] = []

        def fetch_page(params: dict[str, str]) -> object:
            calls.append(dict(params))
            return pages[int(params["page"])]

        records = harvest_pages(
            fetch_page,
            {
                "updatefrom": "20260801",
                "updateuntil": "20260831",
                "order": "updateDate.asc",
            },
            max_pages=5,
            max_records=20,
            delay_seconds=0,
            seen_at=SEEN_AT,
        )

        self.assertEqual([call["page"] for call in calls], ["1", "2", "3"])
        for call in calls:
            self.assertEqual(call["updatefrom"], "20260801")
            self.assertEqual(call["updateuntil"], "20260831")
            self.assertEqual(call["order"], "updateDate.asc")
        self.assertEqual([record["provider_record_id"] for record in records], ["7", "290743"])
        self.assertEqual(records[1]["title_local"], "ชื่อที่ปรับปรุง")

    def test_pagination_is_bounded_and_repeated_pages_fail_closed(self) -> None:
        calls: list[int] = []

        def unique_page(params: dict[str, str]) -> object:
            page = int(params["page"])
            calls.append(page)
            return [sample_row(bibid=page, title=f"เรื่อง {page}")]

        records = harvest_pages(
            unique_page,
            max_pages=2,
            max_records=100,
            delay_seconds=0,
            seen_at=SEEN_AT,
        )
        self.assertEqual(calls, [1, 2])
        self.assertEqual(len(records), 2)

        with self.assertRaisesRegex(RuntimeError, "repeated page"):
            harvest_pages(
                lambda _params: [sample_row()],
                max_pages=2,
                max_records=100,
                delay_seconds=0,
                seen_at=SEEN_AT,
            )

    def test_validation_rejects_abstract_fields_and_promoted_rights(self) -> None:
        record = canonical_record(sample_row(), seen_at=SEEN_AT)
        with_abstract = copy.deepcopy(record)
        with_abstract["raw_metadata"]["abstractTH"] = "forbidden"
        with self.assertRaisesRegex(ValueError, "unreviewed fields"):
            validate_catalog_record(with_abstract)

        promoted = copy.deepcopy(record)
        promoted["rights_manifest"]["full_text_download"] = True
        with self.assertRaisesRegex(ValueError, "full_text_download"):
            validate_catalog_record(promoted)

    def test_query_builder_uses_documented_incremental_parameter_names(self) -> None:
        args = Namespace(
            title=None,
            author=None,
            co_author=None,
            department="มหาวิทยาลัยตัวอย่าง",
            oecd1="Engineering and technology",
            oecd2=None,
            has_full_report="true",
            create_from=None,
            create_until=None,
            update_from="20260801",
            update_until="20260831",
            order="updateDate.asc",
        )
        params = build_query_params(args)

        self.assertEqual(TNRR_RESEARCH_OUTPUT_ENDPOINT, "https://api.nriis.go.th/service/tnrr/v1/ResearchOutput")
        self.assertEqual(params["updatefrom"], "20260801")
        self.assertEqual(params["updateuntil"], "20260831")
        self.assertEqual(params["oECD1"], "Engineering and technology")
        self.assertEqual(params["hasfullReport"], "true")
        self.assertNotIn("page", params)


if __name__ == "__main__":
    unittest.main()
