import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.build_native_reader_cohort import (
    PublisherClient,
    load_delivery_manifest,
    load_plan,
    parse_article_html,
    parse_issue_html,
    publisher_path_allowed,
)


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "pipeline" / "cohorts" / "bscm_tci1_100.json"
CLI = ROOT / "pipeline" / "build_native_reader_cohort.py"


class NativeReaderCohortCliTest(unittest.TestCase):
    def test_committed_plan_is_a_fixed_one_hundred_paper_release_contract(self) -> None:
        result = subprocess.run(
            ["python3", str(CLI), "--cohort", str(PLAN), "--validate-plan"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "plan_valid")
        self.assertEqual(payload["cohortId"], "bscm-tci1-original-review-100")
        self.assertEqual(payload["papers"], 100)
        self.assertEqual(payload["tciTier"], "group_1")
        self.assertEqual(payload["licenseExpression"], "CC-BY-4.0")
        self.assertTrue(payload["medicalResearchOnly"])

    def test_plan_validation_fails_closed_when_issue_denominator_changes(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        plan["issues"][0]["expectedEligible"] -= 1
        with tempfile.TemporaryDirectory() as directory:
            changed = Path(directory) / "changed.json"
            changed.write_text(json.dumps(plan), encoding="utf-8")
            result = subprocess.run(
                ["python3", str(CLI), "--cohort", str(changed), "--validate-plan"],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expectedEligiblePapers", result.stderr)

    def test_issue_parser_only_accepts_the_reviewed_sections(self) -> None:
        html = """
        <div class="sections">
          <div class="section"><h2>Original Article</h2><ul>
            <li><div class="obj_article_summary"><h3 class="title"><a href="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/100">Accepted original</a></h3></div></li>
          </ul></div>
          <div class="section"><h2>Review Article</h2><ul>
            <li><div class="obj_article_summary"><h3 class="title"><a href="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/101">Accepted review</a></h3></div></li>
          </ul></div>
          <div class="section"><h2>Case Report</h2><ul>
            <li><div class="obj_article_summary"><h3 class="title"><a href="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/102">Excluded case</a></h3></div></li>
          </ul></div>
        </div>
        """
        records = parse_issue_html(
            html,
            issue_id="fixture",
            allowed_sections=["Original Article", "Review Article"],
        )
        self.assertEqual([record["articleId"] for record in records], ["100", "101"])
        self.assertEqual([record["section"] for record in records], ["Original Article", "Review Article"])

    def test_v2_plan_supports_a_non_medical_official_thaijo_cohort(self) -> None:
        plan = {
            "version": "seedy-native-cohort-plan-v2",
            "cohortId": "area-based-approved-batch-001",
            "provider": "tci_thaijo",
            "sourceHost": "so01.tci-thaijo.org",
            "sourcePrefix": "abcjournal",
            "journalSlug": "abcjournal",
            "journalTitle": "Area Based Development Research Journal",
            "publisher": "Thailand Science Research and Innovation",
            "discipline": "social_sciences",
            "tciTier": "group_1",
            "tciEvidenceUrl": "https://www.tci-thaijo.org/en/journals/abcjournal",
            "licenseExpression": "CC-BY-4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "rightsEvidenceUrl": "https://so01.tci-thaijo.org/index.php/abcjournal/about",
            "medicalResearchOnly": False,
            "allowedSections": ["Research Article"],
            "expectedEligiblePapers": 1,
            "minimumNativePapers": 1,
            "assetDelivery": {
                "mode": "publisher_manifest",
                "evidenceId": "publisher-manifest-2026-001",
                "takedownContact": "journal@example.ac.th"
            },
            "issues": [{
                "issueId": "12345",
                "label": "Approved batch issue",
                "url": "https://so01.tci-thaijo.org/index.php/abcjournal/issue/view/12345",
                "expectedEligible": 1
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            loaded = load_plan(path)
        self.assertEqual(loaded["sourceHost"], "so01.tci-thaijo.org")
        self.assertFalse(loaded["medicalResearchOnly"])
        self.assertEqual(loaded["assetDelivery"]["mode"], "publisher_manifest")

    def test_v2_plan_rejects_automated_pdf_crawl_delivery(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        plan.update({
            "version": "seedy-native-cohort-plan-v2",
            "sourceHost": "he01.tci-thaijo.org",
            "sourcePrefix": "bscm",
            "minimumNativePapers": 100,
            "assetDelivery": {
                "mode": "automated_pdf_crawl",
                "evidenceId": "none",
                "takedownContact": "journal@example.ac.th"
            }
        })
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "assetDelivery.mode"):
                load_plan(path)

    def test_v2_plan_rejects_placeholder_delivery_evidence(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        plan.update({
            "version": "seedy-native-cohort-plan-v2",
            "sourceHost": "he01.tci-thaijo.org",
            "sourcePrefix": "bscm",
            "minimumNativePapers": 100,
            "assetDelivery": {
                "mode": "publisher_manifest",
                "evidenceId": "pending",
                "takedownContact": "journal@example.ac.th",
            },
        })
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a placeholder"):
                load_plan(path)

    def test_issue_parser_accepts_only_the_configured_official_host(self) -> None:
        html = """
        <div class="sections"><div class="section"><h2>Research Article</h2>
          <div class="obj_article_summary"><h3 class="title">
            <a href="https://so01.tci-thaijo.org/index.php/abcjournal/article/view/200">Accepted</a>
          </h3></div>
        </div></div>
        """
        records = parse_issue_html(
            html,
            issue_id="fixture",
            allowed_sections=["Research Article"],
            expected_host="so01.tci-thaijo.org",
        )
        self.assertEqual([record["articleId"] for record in records], ["200"])
        with self.assertRaisesRegex(ValueError, "non-reviewed article URL"):
            parse_issue_html(
                html,
                issue_id="fixture",
                allowed_sections=["Research Article"],
                expected_host="he01.tci-thaijo.org",
            )

    def test_build_requires_an_approved_local_asset_delivery(self) -> None:
        result = subprocess.run(
            ["python3", str(CLI), "--cohort", str(PLAN), "--build"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--asset-dir", result.stderr)

    def test_build_requires_a_checksum_bound_delivery_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [
                    "python3",
                    str(CLI),
                    "--cohort",
                    str(PLAN),
                    "--build",
                    "--asset-dir",
                    directory,
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--delivery-manifest", result.stderr)

    def test_publisher_fetch_boundary_matches_thaijo_robots_policy(self) -> None:
        self.assertTrue(publisher_path_allowed("/index.php/abcjournal/issue/view/12345"))
        self.assertTrue(publisher_path_allowed("/index.php/abcjournal/article/view/200"))
        self.assertFalse(publisher_path_allowed("/index.php/abcjournal/article/download/200/300"))
        self.assertFalse(publisher_path_allowed("/index.php/abcjournal/issue/download/12345/full"))
        self.assertFalse(publisher_path_allowed("/index.php/abcjournal/article/view/200/300"))

    def test_cached_publisher_fetch_cannot_bypass_the_robots_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "unsafe.html").write_bytes(b"cached")
            client = PublisherClient(cache, 5.0, 1, {"so01.tci-thaijo.org"})
            with self.assertRaisesRegex(ValueError, "robots boundary"):
                client.fetch(
                    "https://so01.tci-thaijo.org/index.php/abcjournal/article/download/200/300",
                    "unsafe.html",
                )

    def test_cli_rejects_an_unsafe_publisher_request_rate(self) -> None:
        result = subprocess.run(
            [
                "python3",
                str(CLI),
                "--cohort",
                str(PLAN),
                "--harvest",
                "--request-delay-seconds",
                "0",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("at least 5 seconds", result.stderr)

    def test_delivery_manifest_binds_every_article_to_one_checksum(self) -> None:
        plan = {
            "provider": "tci_thaijo",
            "journalSlug": "abcjournal",
            "assetDelivery": {"evidenceId": "publisher-manifest-2026-001"},
        }
        manifest = {
            "version": "seedy-approved-asset-delivery-v1",
            "evidenceId": "publisher-manifest-2026-001",
            "provider": "tci_thaijo",
            "journalSlug": "abcjournal",
            "assets": [{
                "articleId": "200",
                "filename": "article-200.pdf",
                "sha256": "a" * 64,
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "delivery.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            loaded = load_delivery_manifest(path, plan=plan, expected_article_ids=["200"])
            manifest["assets"].append({
                "articleId": "201",
                "filename": "../outside.pdf",
                "sha256": "b" * 64,
            })
            unsafe = Path(directory) / "unsafe.json"
            unsafe.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "article denominator"):
                load_delivery_manifest(unsafe, plan=plan, expected_article_ids=["200"])
        self.assertEqual(loaded["200"]["sha256"], "a" * 64)

    def test_article_parser_requires_item_level_cc_by_and_pdf_metadata(self) -> None:
        html = """
        <head>
          <meta name="DC.Identifier" content="100" />
          <meta name="DC.Identifier.pageNumber" content="11-19" />
          <meta name="DC.Date.issued" content="2025-08-20" />
          <meta name="DC.Language" content="en" />
          <meta name="DC.Rights" content="https://creativecommons.org/licenses/by/4.0/" />
          <meta name="DC.Type.articleType" content="Original Article" />
          <meta name="citation_title" content="A reviewed paper" />
          <meta name="citation_author" content="First Author" />
          <meta name="citation_author" content="Second Author" />
          <meta name="citation_pdf_url" content="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/download/100/200" />
        </head>
        <a rel="license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
        """
        parsed = parse_article_html(
            html,
            article_url="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/100",
            expected_article_id="100",
            expected_section="Original Article",
            license_url="https://creativecommons.org/licenses/by/4.0/",
        )
        self.assertEqual(parsed["title"], "A reviewed paper")
        self.assertEqual(parsed["authors"], ["First Author", "Second Author"])
        self.assertEqual(parsed["firstPageLabel"], 11)
        self.assertEqual(parsed["lastPageLabel"], 19)
        self.assertEqual(parsed["doi"], None)

        with self.assertRaisesRegex(ValueError, "item-level license"):
            parse_article_html(
                html.replace("https://creativecommons.org/licenses/by/4.0/", "https://creativecommons.org/licenses/by-nc-nd/4.0/"),
                article_url="https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/100",
                expected_article_id="100",
                expected_section="Original Article",
                license_url="https://creativecommons.org/licenses/by/4.0/",
            )


if __name__ == "__main__":
    unittest.main()
