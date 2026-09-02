import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.native_portfolio import load_portfolio, portfolio_summary


ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO = ROOT / "pipeline" / "cohorts" / "native_5000_portfolio.json"
CLI = ROOT / "pipeline" / "native_portfolio.py"


class NativePortfolioTest(unittest.TestCase):
    def test_committed_portfolio_separates_screening_from_verified_native_count(self) -> None:
        result = subprocess.run(
            ["python3", str(CLI), "--portfolio", str(PORTFOLIO), "--validate"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "portfolio_valid")
        self.assertEqual(payload["targetNativePapers"], 5_000)
        self.assertEqual(payload["currentNativePapers"], 103)
        self.assertEqual(payload["netNewRequired"], 4_897)
        self.assertEqual(payload["firstMilestone"]["targetNativePapers"], 1_000)
        self.assertEqual(payload["firstMilestone"]["screeningCandidates"], 1_685)
        self.assertEqual(payload["firstMilestone"]["netNewRequired"], 897)
        self.assertAlmostEqual(payload["firstMilestone"]["requiredPassRate"], 0.5323, places=4)
        self.assertGreaterEqual(payload["sourceCount"], 8)
        self.assertTrue(payload["agreementRequiredFor5000"])
        self.assertEqual(payload["publicLicenseNetNewScreeningPool"], 4_030)
        self.assertEqual(payload["publicLicenseScreeningShortfall"], 867)
        self.assertEqual(payload["agreementCandidateLowerBound"], 50_000)

    def test_portfolio_rejects_automated_pdf_crawling(self) -> None:
        portfolio = json.loads(PORTFOLIO.read_text(encoding="utf-8"))
        portfolio["acquisitionPolicy"]["automatedPdfCrawl"] = True
        with tempfile.TemporaryDirectory() as directory:
            changed = Path(directory) / "unsafe.json"
            changed.write_text(json.dumps(portfolio), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "automatedPdfCrawl"):
                load_portfolio(changed)

    def test_portfolio_never_counts_screening_candidates_as_verified(self) -> None:
        portfolio = load_portfolio(PORTFOLIO)
        summary = portfolio_summary(portfolio)
        self.assertEqual(
            sum(source["currentNativePapers"] for source in portfolio["sources"]),
            summary["currentNativePapers"],
        )
        self.assertGreater(
            sum(source["screeningCandidates"] for source in portfolio["sources"]),
            summary["currentNativePapers"],
        )


if __name__ == "__main__":
    unittest.main()
