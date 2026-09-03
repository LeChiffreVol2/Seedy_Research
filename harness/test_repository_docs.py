"""Public entry points must resolve and describe the current browser contract."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY_DOCS = (
    "README.md", "AGENTS.md", "BUILD_WEEK.md", "web/README.md",
    "docs/WEBMCP_CHALLENGE_SUBMISSION.md", "docs/CORPUS_STATUS.md",
    "docs/LEGACY_COMPATIBILITY.md", "docs/HARNESS.md", "docs/OPERATIONS.md",
)


class RepositoryDocsTests(unittest.TestCase):
    def test_entry_document_local_links_resolve(self):
        for name in ENTRY_DOCS:
            path = ROOT / name
            for target in re.findall(r"\]\(([^\s)]+)\)", path.read_text()):
                if "://" in target or target.startswith(("#", "mailto:")):
                    continue
                with self.subTest(document=name, target=target):
                    self.assertTrue((path.parent / target.split("#")[0]).exists())

    def test_public_tool_tables_match_runtime(self):
        runtime = (ROOT / "web/lib/webmcp.ts").read_text()
        expected = set(re.findall(r'name: "([a-z_]+)"', runtime))
        self.assertEqual(len(expected), 8)
        for name in ("README.md", "docs/WEBMCP_CHALLENGE_SUBMISSION.md"):
            with self.subTest(document=name):
                documented = set(re.findall(r"^\| `([a-z_]+)` \|", (ROOT / name).read_text(), re.M))
                self.assertEqual(documented, expected)

    def test_city_application_and_workflows_are_archived(self):
        self.assertFalse((ROOT / "citymcp/ops-dashboard/package.json").exists())
        self.assertEqual(list((ROOT / ".github/workflows").glob("citymcp-*.yml")), [])
        self.assertIn("archive/citymcp-before-seedy-cleanup-2026-09-04", (ROOT / "docs/LEGACY_COMPATIBILITY.md").read_text())


if __name__ == "__main__":
    unittest.main()
