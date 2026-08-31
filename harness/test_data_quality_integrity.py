from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HARNESS_DIR = Path(__file__).resolve().parent
if str(HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR))

import run_data_quality  # noqa: E402


def write_document(
    root: Path,
    name: str,
    title: str,
    pages: list[int],
    *,
    declared_start: int | str | None = None,
    declared_end: int | str | None = None,
    evidence: str = "repeatable evidence " * 90,
) -> None:
    start = pages[0] if declared_start is None else declared_start
    end = pages[-1] if declared_end is None else declared_end
    lines = [
        "---",
        "collection: ncce",
        f"page_start: {start}",
        f"page_end: {end}",
        "---",
        "",
        f"# {title}",
        "",
    ]
    for page in pages:
        lines.extend([f"## Page {page}", "", evidence, ""])
    (root / name).write_text("\n".join(lines), encoding="utf-8")


def write_exclusion_manifest(root: Path, *, similarity: float = 1.0) -> Path:
    path = root / "evidence_exclusions.json"
    path.write_text(
        json.dumps(
            {
                "manifest_version": 1,
                "exclusions": [
                    {
                        "source": "NCCE31_CEM-49.md",
                        "document_id": "NCCE31_CEM-49",
                        "canonical_source": "NCCE31_TRL-26.md",
                        "canonical_document_id": "NCCE31_TRL-26",
                        "reason": "Reviewed duplicate proceedings occurrence retained under transport.",
                        "reviewed_by": "Corpus QA",
                        "reviewed_at": "2026-08-31",
                        "body_similarity": similarity,
                        "evidence": ["Same title.", "Same normalized body."],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


class MarkdownCorpusIntegrityTests(unittest.TestCase):
    def run_check(
        self,
        root: Path,
        exclusions_path: Path | None = None,
    ) -> tuple[run_data_quality.Check, dict[str, object]]:
        with (
            patch.object(run_data_quality, "MD_DIR", root),
            patch.object(run_data_quality, "TITLE_OVERRIDES_PATH", root / "missing-overrides.json"),
            patch.object(
                run_data_quality,
                "EVIDENCE_EXCLUSIONS_PATH",
                exclusions_path or run_data_quality.EVIDENCE_EXCLUSIONS_PATH,
            ),
        ):
            check = run_data_quality.markdown_integrity_check()
        return check, json.loads(check.details)

    def test_allows_strictly_increasing_markers_with_gap_of_two(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_document(root, "good.md", "Unique result", [10, 11, 13])

            check, details = self.run_check(root)

        self.assertEqual(check.status, "pass")
        self.assertEqual(details["pageBoundaryViolationCount"], 0)
        self.assertEqual(details["probableDuplicatePairCount"], 0)

    def test_fails_non_increasing_marker_severe_gap_and_declared_range_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_document(root, "non-increasing.md", "First result", [10, 10])
            write_document(
                root,
                "gap.md",
                "Second result",
                [1, 5],
                declared_start=1,
                declared_end=4,
            )

            check, details = self.run_check(root)

        kinds = {item["kind"] for item in details["pageBoundaryOffenders"]}
        self.assertEqual(check.status, "fail")
        self.assertEqual(
            kinds,
            {
                "non_increasing_page_markers",
                "page_marker_gap",
                "declared_page_range_mismatch",
            },
        )

    def test_detects_duplicate_body_only_with_same_normalized_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = "same material finding with stable measurements " * 80
            write_document(root, "first.md", "Shared: Result", [1], evidence=evidence)
            write_document(root, "second.md", "shared result", [101], evidence=evidence)
            write_document(root, "different-title.md", "Independent result", [201], evidence=evidence)

            check, details = self.run_check(root)

        self.assertEqual(check.status, "fail")
        self.assertEqual(details["probableDuplicatePairCount"], 1)
        self.assertEqual(
            details["probableDuplicatePairs"][0]["files"],
            ["first.md", "second.md"],
        )
        self.assertEqual(details["probableDuplicatePairs"][0]["bodySimilarity"], 1.0)

    def test_reviewed_index_exclusion_clears_only_exact_canonical_pair(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = "same material finding with stable measurements " * 80
            write_document(root, "NCCE31_CEM-49.md", "Shared result", [1], evidence=evidence)
            write_document(root, "NCCE31_TRL-26.md", "Shared result", [101], evidence=evidence)
            manifest_path = write_exclusion_manifest(root)

            check, details = self.run_check(root, manifest_path)

        self.assertEqual(check.status, "pass")
        self.assertEqual(details["totalFiles"], 2)
        self.assertEqual(details["indexEligibleFiles"], 1)
        self.assertEqual(details["reviewedExclusionCount"], 1)
        self.assertEqual(details["reviewedDuplicatePairCount"], 1)
        self.assertEqual(details["unresolvedProbableDuplicatePairCount"], 0)

    def test_invalid_manifest_does_not_clear_probable_duplicate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = "same material finding with stable measurements " * 80
            write_document(root, "NCCE31_CEM-49.md", "Shared result", [1], evidence=evidence)
            write_document(root, "NCCE31_TRL-26.md", "Shared result", [101], evidence=evidence)
            manifest_path = write_exclusion_manifest(root, similarity=0.5)

            check, details = self.run_check(root, manifest_path)

        self.assertEqual(check.status, "fail")
        self.assertIn("body_similarity", details["exclusionManifestError"])
        self.assertEqual(details["reviewedDuplicatePairCount"], 0)
        self.assertEqual(details["unresolvedProbableDuplicatePairCount"], 1)


if __name__ == "__main__":
    unittest.main()
