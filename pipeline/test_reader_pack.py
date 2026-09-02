import hashlib
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse
from unittest.mock import patch

from pipeline.ingest_reader_pack import (
    apply_rows,
    build_rows,
    plan_apply_batches,
    read_pack,
    select_pack_window,
)


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "web" / "data" / "reader-papers"


class ReaderPackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((PACK / "manifest.json").read_text(encoding="utf-8"))

    def test_pack_contains_three_distinct_rights_reviewed_papers(self) -> None:
        papers = self.manifest["papers"]
        self.assertEqual(len(papers), 3)
        self.assertEqual(len({paper["source"] for paper in papers}), 3)
        self.assertEqual(len({paper["providerRecordId"] for paper in papers}), 3)
        self.assertTrue(all(paper["provider"] == "tci_thaijo" for paper in papers))

    def test_native_assets_fail_closed_unless_every_required_right_is_verified(self) -> None:
        required_actions = ("asset_storage", "text_extraction", "native_fulltext_display", "annotation")
        for paper in self.manifest["papers"]:
            asset = paper["asset"]
            with self.subTest(source=paper["source"]):
                self.assertEqual(asset["readerAccessMode"], "native_verified")
                self.assertEqual(asset["rightsStatus"], "open_license_verified")
                self.assertEqual(asset["licenseExpression"], "CC-BY-4.0")
                self.assertEqual(len(asset["contentSha256"]), 64)
                self.assertTrue(asset["rightsVerifiedAt"])
                self.assertTrue(asset["rightsCheckedAt"])
                self.assertTrue(asset["rightsProvenance"]["basis"])
                self.assertEqual(
                    urlparse(asset["rightsProvenance"]["source"]).netloc,
                    "so04.tci-thaijo.org",
                )
                self.assertTrue(all(asset["rightsActions"][action] for action in required_actions))
                self.assertFalse(asset["rightsActions"]["model_training"])

    def test_every_page_has_a_stable_anchor_and_integrity_hash(self) -> None:
        for paper in self.manifest["papers"]:
            payload = json.loads((PACK / paper["pagesFile"]).read_text(encoding="utf-8"))
            pages = payload["pages"]
            with self.subTest(source=paper["source"]):
                self.assertEqual(payload["source"], paper["source"])
                self.assertEqual(len(pages), paper["asset"]["pageCount"])
                self.assertEqual([page["pageNumber"] for page in pages], list(range(1, len(pages) + 1)))
                self.assertEqual(len({page["anchor"] for page in pages}), len(pages))
                for page in pages:
                    self.assertTrue(page["text"].strip())
                    self.assertEqual(
                        hashlib.sha256(page["text"].encode("utf-8")).hexdigest(),
                        page["textSha256"],
                    )

    def test_attribution_and_source_download_remain_available(self) -> None:
        for paper in self.manifest["papers"]:
            asset = paper["asset"]
            with self.subTest(source=paper["source"]):
                self.assertTrue(paper["authors"])
                self.assertTrue(paper["doi"].startswith("10."))
                self.assertEqual(urlparse(paper["sourceUrl"]).netloc, "so04.tci-thaijo.org")
                self.assertEqual(urlparse(asset["originUrl"]).netloc, "so04.tci-thaijo.org")
                self.assertIn("LEARN Journal", asset["rightsProvenance"]["attribution"])
                self.assertIn("converted", asset["rightsProvenance"]["transformationNotice"])

    def test_ingest_rows_preserve_work_asset_page_and_rights_boundaries(self) -> None:
        _, papers = read_pack(PACK)
        rows = [build_rows(paper, pages) for paper, pages in papers]
        self.assertEqual(sum(len(row["pages"]) for row in rows), 68)
        for row in rows:
            with self.subTest(source=row["catalog"]["provider_record_id"]):
                self.assertEqual(row["catalog"]["work_id"], row["work"]["work_id"])
                self.assertEqual(row["asset"]["work_id"], row["work"]["work_id"])
                self.assertEqual(row["asset"]["reader_access_mode"], "native_verified")
                self.assertEqual(row["catalog"]["evidence_status"], "extracted")
                self.assertTrue(row["catalog"]["rights_manifest"]["full_text_download"])
                self.assertFalse(row["catalog"]["rights_manifest"]["model_training"])
                self.assertTrue(all(page["asset_id"] == row["asset"]["asset_id"] for page in row["pages"]))
                self.assertTrue(all(page["extraction_provenance"]["source_asset_sha256"] == row["asset"]["content_sha256"] for page in row["pages"]))

    def test_release_pack_cannot_claim_a_hundred_paper_floor_with_fewer_papers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            for paper in self.manifest["papers"]:
                shutil.copy(PACK / paper["pagesFile"], pack / paper["pagesFile"])
            manifest = {
                **self.manifest,
                "releaseGate": {
                    "minimumNativePapers": 100,
                    "expectedNativePapers": 100,
                    "allowedArticleTypes": ["Original Article", "Review Article"],
                    "medicalResearchOnly": True,
                },
            }
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "minimumNativePapers"):
                read_pack(pack)

    def test_approved_non_medical_cohort_keeps_its_own_section_and_tci_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            paper = deepcopy(self.manifest["papers"][0])
            shutil.copy(PACK / paper["pagesFile"], pack / paper["pagesFile"])
            paper["articleType"] = "Research Article"
            paper["tciTier"] = "group_1"
            paper["medicalResearchOnly"] = False
            manifest = {
                **self.manifest,
                "papers": [paper],
                "releaseGate": {
                    "minimumNativePapers": 1,
                    "expectedNativePapers": 1,
                    "allowedArticleTypes": ["Research Article"],
                    "allowedTciTiers": ["group_1"],
                    "medicalResearchOnly": False,
                    "assetDeliveryMode": "publisher_manifest",
                },
            }
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            _, papers = read_pack(pack)
        self.assertEqual(len(papers), 1)
        self.assertFalse(papers[0][0]["medicalResearchOnly"])

    def test_approved_thai_affiliated_open_data_cohort_uses_its_own_provider_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            paper = deepcopy(self.manifest["papers"][0])
            pages_payload = json.loads((PACK / paper["pagesFile"]).read_text(encoding="utf-8"))
            paper.update({
                "source": "pmc:PMC123456.1",
                "provider": "pmc_oa",
                "providerRecordId": "PMC123456.1",
                "collection": "thai_affiliated_global_oa",
                "sourceType": "journal_article",
                "articleType": "Research Article",
                "tciTier": None,
                "medicalResearchOnly": True,
                "affiliationCountries": ["TH"],
                "thaiAffiliationEvidence": ["Example University, Bangkok, Thailand"],
                "sourceUrl": "https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/",
            })
            paper["asset"] = {
                **paper["asset"],
                "id": "pmc-PMC123456.1-pdf",
                "originUrl": "https://pmc-oa-opendata.s3.amazonaws.com/PMC123456.1/PMC123456.1.pdf",
                "licenseExpression": "CC-BY-4.0",
                "rightsProvenance": {
                    **paper["asset"]["rightsProvenance"],
                    "source": "https://pmc-oa-opendata.s3.amazonaws.com/metadata/PMC123456.1.json",
                    "affiliationEvidence": ["Example University, Bangkok, Thailand"],
                },
            }
            pages_payload["source"] = paper["source"]
            (pack / paper["pagesFile"]).write_text(json.dumps(pages_payload), encoding="utf-8")
            manifest = {
                **self.manifest,
                "papers": [paper],
                "releaseGate": {
                    "minimumNativePapers": 1,
                    "expectedNativePapers": 1,
                    "allowedProviders": ["pmc_oa"],
                    "allowedArticleTypes": ["Research Article"],
                    "requiredAffiliationCountry": "TH",
                    "medicalResearchOnly": True,
                    "assetDeliveryMode": "official_open_data_cloud",
                },
            }
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            _, papers = read_pack(pack)
            row = build_rows(papers[0][0], papers[0][1])

        self.assertEqual(row["catalog"]["provider"], "pmc_oa")
        self.assertEqual(row["catalog"]["collection"], "thai_affiliated_global_oa")
        self.assertEqual(row["catalog"]["source_type"], "journal_article")
        self.assertEqual(row["catalog"]["raw_metadata"]["affiliation_countries"], ["TH"])
        self.assertIn("Thailand", row["catalog"]["raw_metadata"]["thai_affiliation_evidence"][0])
        self.assertEqual(row["pages"][0]["extraction_provenance"]["method"], "pdftotext-layout")

    def test_open_data_release_rejects_a_paper_without_required_thai_affiliation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pack = Path(directory)
            paper = deepcopy(self.manifest["papers"][0])
            shutil.copy(PACK / paper["pagesFile"], pack / paper["pagesFile"])
            paper.update({
                "provider": "pmc_oa",
                "providerRecordId": "PMC123456.1",
                "articleType": "Research Article",
                "tciTier": None,
                "medicalResearchOnly": True,
                "affiliationCountries": ["US"],
                "thaiAffiliationEvidence": [],
            })
            manifest = {
                **self.manifest,
                "papers": [paper],
                "releaseGate": {
                    "minimumNativePapers": 1,
                    "expectedNativePapers": 1,
                    "allowedProviders": ["pmc_oa"],
                    "allowedArticleTypes": ["Research Article"],
                    "requiredAffiliationCountry": "TH",
                    "medicalResearchOnly": True,
                    "assetDeliveryMode": "official_open_data_cloud",
                },
            }
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "affiliation"):
                read_pack(pack)

    def test_ingest_identity_falls_back_to_provider_identifier_when_doi_is_absent(self) -> None:
        paper = deepcopy(self.manifest["papers"][0])
        paper["doi"] = None
        paper["discipline"] = "medical_and_health_sciences"
        paper["articleType"] = "Original Article"
        paper["medicalResearchOnly"] = True
        payload = json.loads((PACK / paper["pagesFile"]).read_text(encoding="utf-8"))
        row = build_rows(paper, payload["pages"])
        self.assertEqual(row["work"]["canonical_key"], f"provider:tci_thaijo:{paper['providerRecordId']}")
        self.assertEqual(row["work"]["identity_strategy"], "provider_identifier")
        self.assertIsNone(row["work"]["doi_normalized"])
        self.assertEqual(row["catalog"]["doi"], None)
        self.assertEqual(row["catalog"]["discipline"], "medical_and_health_sciences")
        self.assertTrue(row["catalog"]["raw_metadata"]["medical_research_only"])

    def test_five_thousand_paper_apply_plan_stays_bounded(self) -> None:
        plan = plan_apply_batches(
            paper_count=5_000,
            page_count=53_640,
            provider_count=10,
            batch_size=200,
            page_batch_size=200,
        )
        self.assertEqual(plan["papers"], 5_000)
        self.assertEqual(plan["pages"], 53_640)
        self.assertLessEqual(plan["estimatedApiRequests"], 410)
        self.assertEqual(plan["legacyEstimatedApiRequests"], 30_002)

    def test_pack_window_supports_repeatable_two_hundred_fifty_paper_promotions(self) -> None:
        papers = [(f"paper-{index}", []) for index in range(5_000)]
        selected, window = select_pack_window(papers, start=4_750, maximum=250)
        self.assertEqual(len(selected), 250)
        self.assertEqual(selected[0][0], "paper-4750")
        self.assertEqual(selected[-1][0], "paper-4999")
        self.assertEqual(window, {
            "totalPapers": 5_000,
            "startPaper": 4_750,
            "selectedPapers": 250,
            "nextStartPaper": None,
            "remainingPapers": 0,
        })

    def test_apply_uses_bulk_identity_reads_and_bounded_upserts(self) -> None:
        class FakeResponse:
            def __init__(self, data: list[dict[str, object]]) -> None:
                self.data = data

        class FakeQuery:
            def __init__(self, client: "FakeClient", table: str) -> None:
                self.client = client
                self.table = table
                self.operation = ""
                self.payload: object = None

            def select(self, _columns: str) -> "FakeQuery":
                self.operation = "select"
                return self

            def insert(self, payload: object) -> "FakeQuery":
                self.operation = "insert"
                self.payload = payload
                return self

            def upsert(self, payload: object, **_kwargs: object) -> "FakeQuery":
                self.operation = "upsert"
                self.payload = payload
                return self

            def update(self, payload: object) -> "FakeQuery":
                self.operation = "update"
                self.payload = payload
                return self

            def eq(self, *_args: object) -> "FakeQuery":
                return self

            def in_(self, *_args: object) -> "FakeQuery":
                return self

            def execute(self) -> FakeResponse:
                self.client.calls.append((self.table, self.operation, self.payload))
                if self.table == "civil_ingest_runs" and self.operation == "insert":
                    return FakeResponse([{"id": "run-1"}])
                return FakeResponse([])

        class FakeClient:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str, object]] = []

            def table(self, name: str) -> FakeQuery:
                return FakeQuery(self, name)

        _, papers = read_pack(PACK)
        rows = [build_rows(paper, pages) for paper, pages in papers]
        client = FakeClient()
        fake_supabase = types.ModuleType("supabase")
        fake_supabase.create_client = lambda _url, _key: client  # type: ignore[attr-defined]
        with patch.dict(sys.modules, {"supabase": fake_supabase}), patch.dict(
            os.environ,
            {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_KEY": "test-key"},
        ):
            apply_rows(rows, batch_size=2, page_batch_size=20)

        self.assertEqual(len(client.calls), 16)
        writes = [payload for _table, operation, payload in client.calls if operation == "upsert"]
        self.assertTrue(writes)
        self.assertLessEqual(max(len(payload) for payload in writes if isinstance(payload, list)), 20)


if __name__ == "__main__":
    unittest.main()
