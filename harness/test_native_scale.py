from __future__ import annotations

import unittest
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
if str(HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR))

from run_native_scale import capacity_projection, choose_cursor_offset


class NativeScaleHarnessTests(unittest.TestCase):
    def test_target_cursor_reaches_paper_five_thousand_when_catalog_is_populated(self) -> None:
        self.assertEqual(
            choose_cursor_offset(target_native_papers=5_000, catalog_total=7_578, page_size=30),
            4_990,
        )

    def test_live_smoke_uses_deepest_full_page_before_target_is_populated(self) -> None:
        self.assertEqual(
            choose_cursor_offset(target_native_papers=5_000, catalog_total=2_681, page_size=30),
            2_651,
        )

    def test_projection_uses_the_observed_production_page_mean(self) -> None:
        self.assertEqual(
            capacity_projection(
                target_native_papers=5_000,
                observed_native_papers=103,
                observed_pages=1_105,
            ),
            {"targetNativePapers": 5_000, "projectedPagesAtCurrentMean": 53_641},
        )


if __name__ == "__main__":
    unittest.main()
