import hashlib
import json
import unittest
from pathlib import Path
from urllib.parse import urlparse

from pipeline.ingest_reader_pack import build_rows, read_pack


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


if __name__ == "__main__":
    unittest.main()
