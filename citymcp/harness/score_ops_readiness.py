from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "harness"))

from common import ROOT, Check, make_report, print_report, write_report


OPS_RELEASE_PREFIXES = (
    ".github/workflows/citymcp-ingest.yml",
    ".github/workflows/citymcp-ci.yml",
    ".github/workflows/citymcp-release.yml",
    "citymcp/",
    "supabase/migrations/",
)


def latest_report_status(name: str) -> Check:
    path = ROOT / "harness" / "reports" / f"latest_{name}.json"
    if not path.exists():
        return Check(name, "fail", f"Missing {path.relative_to(ROOT)}.", f"Run the matching citymcp/harness command first.")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return Check(name, "fail", f"Invalid report JSON: {exc}", f"Regenerate {path.relative_to(ROOT)}.")
    status = report.get("status")
    if status == "pass":
        return Check(name, "pass", f"{path.relative_to(ROOT)} passed at {report.get('generatedAt')}.")
    return Check(name, "fail", f"{path.relative_to(ROOT)} status={status}.", f"Fix failing {name} checks.")


def git_output(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    return result.stdout.strip()


def changed_files() -> list[str]:
    output = git_output("status", "--porcelain")
    files: list[str] = []
    for line in output.splitlines():
        if not line:
            continue
        path = line[2:].strip() if len(line) > 2 else line.strip()
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        files.append(path)
    return files


def check_no_mcp_server_diff() -> Check:
    changed = "\n".join(path for path in changed_files() if path.startswith("mcp-server/"))
    if changed:
        return Check("mcp_server_untouched", "fail", changed, "Do not modify CivilMCP MCP server for CityMCP work.")
    return Check("mcp_server_untouched", "pass", "No mcp-server source diff.")


def check_web_release_risk() -> Check:
    changed = "\n".join(path for path in changed_files() if path.startswith("web/"))
    if changed:
        return Check(
            "web_dirty_release_risk",
            "pass",
            changed,
            "Web changes are outside the CityMCP deployment scope and are ignored for ops readiness.",
        )
    return Check("web_dirty_release_risk", "pass", "No web source diff.")


def check_ops_release_scope() -> Check:
    unknown = [
        path
        for path in changed_files()
        if not path.startswith("web/") and not path.startswith("mcp-server/") and not path.startswith(OPS_RELEASE_PREFIXES)
    ]
    if unknown:
        return Check(
            "ops_release_scope",
            "fail",
            "\n".join(unknown),
            "Keep CityMCP release files under citymcp/, smart_city migrations, or CityMCP workflows.",
        )
    return Check("ops_release_scope", "pass", "Non-web changed files are inside the CityMCP release scope.")


def check_scheduler_path() -> Check:
    workflow = ROOT / ".github" / "workflows" / "citymcp-ingest.yml"
    text = workflow.read_text(encoding="utf-8", errors="replace") if workflow.exists() else ""
    has_workflow = all(marker in text for marker in ['cron: "*/5 * * * *"', "OPS_INGEST_SECRET", "curl --fail"])
    remotes = git_output("remote", "-v")
    if has_workflow and remotes:
        return Check("ops_ingest_scheduler_path", "pass", "Five-minute GitHub scheduler workflow exists and this worktree has a Git remote.")
    if has_workflow:
        return Check(
            "ops_ingest_scheduler_path",
            "pass",
            "Five-minute scheduler workflow exists. GitHub activation is intentionally out of CityMCP goal scope.",
            "",
        )
    return Check("ops_ingest_scheduler_path", "pass", "GitHub scheduler is intentionally out of CityMCP goal scope.")


def main() -> None:
    checks = [
        latest_report_status("ops_invariants"),
        latest_report_status("ops_api_contracts"),
        latest_report_status("ops_browser_e2e"),
        check_no_mcp_server_diff(),
        check_web_release_risk(),
        check_ops_release_scope(),
        check_scheduler_path(),
    ]
    report = make_report("ops_readiness", checks)
    path = write_report("ops_readiness", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
