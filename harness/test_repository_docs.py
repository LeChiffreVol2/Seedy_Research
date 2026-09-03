"""Public entry points must resolve and describe the current browser contract."""

import re
import subprocess
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
def markdown_files():
    # Git scopes the audit to published sources, not dependencies or local papers.
    result = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode == 0:
        return sorted({ROOT / name for name in result.stdout.split("\0")
                       if name.lower().endswith((".md", ".mdx")) and (ROOT / name).is_file()})
    # Source archives have no .git; cover the same published documentation roots.
    return sorted({*ROOT.glob("*.md"), *(ROOT / "docs").rglob("*.md"),
                   *(path for directory in ("web", "pipeline", "mcp-server", "eval")
                     for path in (ROOT / directory).glob("*.md"))})


def prose(text):
    return re.sub(r"```[\s\S]*?```", "", text)


class RepositoryDocsTests(unittest.TestCase):
    def test_all_markdown_local_links_resolve(self):
        files = markdown_files()
        self.assertGreaterEqual(len(files), 43)
        for path in files:
            for target in re.findall(r"\]\(([^\s)]+)\)", prose(path.read_text())):
                parsed = urlsplit(target.strip("<>"))
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                with self.subTest(document=str(path.relative_to(ROOT)), target=target):
                    self.assertTrue((path.parent / unquote(parsed.path)).exists())

    def test_current_docs_do_not_restore_retired_paths_or_tool_counts(self):
        for path in markdown_files():
            if "archive" in path.parts or path.name == "LEGACY_COMPATIBILITY.md":
                continue
            text = path.read_text()
            if re.search(r"historical|superseded|original plan", text[:1800], re.I):
                continue
            with self.subTest(document=str(path.relative_to(ROOT))):
                self.assertNotIn("`citymcp/README.md`", text)
                self.assertNotRegex(text, r"(?i)(?:six|seven) (?:top-level |browser-native )?site tools")
                self.assertNotRegex(text, r"site tools ที่(?:หก|เจ็ด)ตัว")

    def test_visibility_glossary_includes_unaudited_state(self):
        glossary = (ROOT / "CONTEXT.md").read_text().split("**Global Visibility State**:", 1)[1].split("_Avoid_", 1)[0]
        self.assertIn("not yet audited", glossary)

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
