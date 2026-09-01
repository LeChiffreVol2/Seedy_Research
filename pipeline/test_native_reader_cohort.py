import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.build_native_reader_cohort import parse_article_html, parse_issue_html


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
