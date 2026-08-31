from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from extract_ncce import (  # noqa: E402
    extract_pdf,
    group_pages_by_paper,
    output_names_for_groups,
)


class NcceExtractionIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pages = [
            "First paper\nABC-01-1",
            "Second paper\nDEF-02-1",
            "Different paper with repeated source code\nABC-01-2",
        ]

    def test_non_contiguous_repeated_code_remains_separate(self) -> None:
        groups = group_pages_by_paper(self.pages)

        self.assertEqual([group.paper_code for group in groups], ["ABC-01", "DEF-02", "ABC-01"])
        self.assertEqual([group.pages[0][0] for group in groups], [1, 2, 3])
        self.assertEqual(
            output_names_for_groups("NCCE31", groups),
            ["NCCE31_ABC-01.md", "NCCE31_DEF-02.md", "NCCE31_ABC-01_P3.md"],
        )

    def test_extract_pdf_keeps_original_code_in_suffixed_document(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            with patch("extract_ncce.run_pdftotext", return_value=self.pages):
                written, skipped = extract_pdf(
                    Path("Proceedings_NCCE31.pdf"),
                    out_dir,
                    overwrite=True,
                    min_groups=1,
                    window_pages=10,
                )

            self.assertEqual((written, skipped), (3, 0))
            repeated = out_dir / "NCCE31_ABC-01_P3.md"
            self.assertTrue(repeated.exists())
            markdown = repeated.read_text(encoding="utf-8")
            self.assertIn("paper_code: ABC-01", markdown)
            self.assertIn("page_start: 3", markdown)
            self.assertIn("page_end: 3", markdown)
            self.assertNotIn("## Page 1", markdown)


if __name__ == "__main__":
    unittest.main()
