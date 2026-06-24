from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from common import ROOT, Check, make_report, print_report, write_report

REQUIRED_DOCS = [
    "AGENTS.md",
    "docs/ARCHITECTURE.md",
    "docs/HARNESS.md",
    "docs/QUALITY_SCORE.md",
    "docs/OPERATIONS.md",
]
REQUIRED_ENV_KEYS = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "MCP_SERVER_API_KEY",
    "AGENTIC_CONTEXT_ENABLED",
    "ROUTER_PROVIDER",
    "ROUTER_MODEL",
    "MAX_AGENT_STEPS",
    "MAX_TOOL_CALLS",
    "MAX_CONTEXT_CHUNKS",
    "MAX_CONTEXT_TOKENS",
    "CHAT_MAX_BODY_BYTES",
    "CHAT_RATE_LIMIT_MAX_CALLS",
    "CHAT_RATE_LIMIT_WINDOW_SECONDS",
    "ANSWER_MAX_TOKENS",
]
SERVER_SECRET_KEYS = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "SUPABASE_SERVICE_KEY", "MCP_SERVER_API_KEY"]
EXPECTED_TOOLS = [
    "search_civil_knowledge",
    "search_civil_sections",
    "search_civil_chunks",
    "fetch_civil_paper",
    "fetch_chunk_neighbors",
    "fetch_paper_outline",
    "list_papers",
    "list_collections",
]


def count_generated_entries(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"= (\{[\s\S]*\});\s*$", text)
    if not match:
        return 0
    return len(json.loads(match.group(1)))


def check_docs() -> Check:
    missing = [name for name in REQUIRED_DOCS if not (ROOT / name).exists()]
    if missing:
        return Check("repo_knowledge_docs", "fail", f"Missing: {', '.join(missing)}", "Create the missing repo knowledge files.")
    return Check("repo_knowledge_docs", "pass", "AGENTS.md and docs system of record are present.")


def check_env_example() -> Check:
    path = ROOT / ".env.example"
    if not path.exists():
        return Check("env_contract", "fail", ".env.example is missing.", "Restore the root .env.example file.")
    text = path.read_text(encoding="utf-8", errors="replace")
    missing = [key for key in REQUIRED_ENV_KEYS if f"{key}=" not in text]
    exposed = [key for key in SERVER_SECRET_KEYS if f"NEXT_PUBLIC_{key}" in text]
    if missing or exposed:
        details = []
        if missing:
            details.append(f"missing={missing}")
        if exposed:
            details.append(f"exposed={exposed}")
        return Check("env_contract", "fail", "; ".join(details), "Keep required server-only keys documented without NEXT_PUBLIC prefixes.")
    return Check("env_contract", "pass", "Required env keys are documented and server-only keys are not NEXT_PUBLIC.")


def check_secret_exposure() -> Check:
    paths = list((ROOT / "web").rglob("*.ts")) + list((ROOT / "web").rglob("*.tsx")) + [ROOT / ".env.example"]
    findings: list[str] = []
    for path in paths:
        if "node_modules" in path.parts or ".next" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for key in SERVER_SECRET_KEYS:
            if f"NEXT_PUBLIC_{key}" in text:
                findings.append(f"{path.relative_to(ROOT)} exposes NEXT_PUBLIC_{key}")
    if findings:
        return Check("server_secret_exposure", "fail", "; ".join(findings[:8]), "Remove NEXT_PUBLIC server-secret references.")
    return Check("server_secret_exposure", "pass", "No NEXT_PUBLIC references to server-only secrets found.")


def check_mcp_tool_annotations() -> Check:
    text = (ROOT / "mcp-server" / "server.py").read_text(encoding="utf-8", errors="replace")
    missing = [tool for tool in EXPECTED_TOOLS if f'"{tool}"' not in text or f"'{tool}'" in ""]
    annotation_missing = []
    for tool in EXPECTED_TOOLS:
        pattern = rf'"{re.escape(tool)}"\s*:\s*\{{[\s\S]*?"annotations"\s*:\s*READ_ONLY_ANNOTATIONS'
        if not re.search(pattern, text):
            annotation_missing.append(tool)
    if missing or annotation_missing or "readOnlyHint" not in text or "destructiveHint" not in text:
        return Check(
            "mcp_tool_annotations",
            "fail",
            f"missing={missing}; annotation_missing={annotation_missing}",
            "Ensure all MCP tools are listed in TOOL_DEFINITIONS with READ_ONLY_ANNOTATIONS.",
        )
    return Check("mcp_tool_annotations", "pass", "MCP tools have read-only annotations in TOOL_DEFINITIONS.")


def check_agent_bounds_and_annotations() -> Check:
    text = (ROOT / "web" / "app" / "api" / "chat" / "route.ts").read_text(encoding="utf-8", errors="replace")
    required = [
        "MAX_AGENT_STEPS",
        "MAX_TOOL_CALLS",
        "MAX_CONTEXT_CHUNKS",
        "MAX_CONTEXT_TOKENS",
        "civilmcp_context",
        "appendMessageAnnotation(contextAnnotation)",
        "evidenceItems",
        "civilmcp_memory",
    ]
    missing = [item for item in required if item not in text]
    bounds_ok = bool(re.search(r"MAX_TOOL_CALLS\s*=\s*clampNumber\([^\n]+,\s*1,\s*8,\s*4\)", text))
    steps_ok = bool(re.search(r"MAX_AGENT_STEPS\s*=\s*clampNumber\([^\n]+,\s*1,\s*5,\s*3\)", text))
    if missing or not bounds_ok or not steps_ok:
        return Check(
            "agentic_bounds_and_response_annotations",
            "fail",
            f"missing={missing}; bounds_ok={bounds_ok}; steps_ok={steps_ok}",
            "Restore bounded agent limits and civilmcp response annotations.",
        )
    return Check("agentic_bounds_and_response_annotations", "pass", "Agent limits and response annotations are present.")


def check_backbone_guardrails() -> Check:
    server_text = (ROOT / "mcp-server" / "server.py").read_text(encoding="utf-8", errors="replace")
    chat_text = (ROOT / "web" / "app" / "api" / "chat" / "route.ts").read_text(encoding="utf-8", errors="replace")
    schema_text = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8", errors="replace")
    required = {
        "mcp_transport_guard": "is_mounted_transport_request" in server_text and "record_transport" in server_text,
        "chat_rate_limit": "checkRateLimit" in chat_text and "CHAT_RATE_LIMIT_MAX_CALLS" in chat_text,
        "chat_body_cap": "readBoundedJson" in chat_text and "CHAT_MAX_BODY_BYTES" in chat_text,
        "trace_annotation": "traceId" in chat_text and "civilmcp_trace" in chat_text,
        "trace_table": "civil_chat_traces" in schema_text,
        "feedback_table": "civil_chat_feedback" in schema_text,
        "workspace_table": "civil_paper_workspace_items" in schema_text,
        "feedback_api": (ROOT / "web" / "app" / "api" / "feedback" / "route.ts").exists(),
        "data_quality_harness": (ROOT / "harness" / "run_data_quality.py").exists(),
    }
    missing = [name for name, ok in required.items() if not ok]
    if missing:
        return Check(
            "backbone_guardrails",
            "fail",
            f"missing={missing}",
            "Restore P0/P1 backbone guardrails before frontend work.",
        )
    return Check("backbone_guardrails", "pass", "Security, trace, feedback, workspace, and data-quality guardrails are present.")


def check_generated_feed_artifacts() -> Check:
    title_path = ROOT / "web" / "lib" / "paper-title-overrides.ts"
    summary_path = ROOT / "web" / "lib" / "paper-summary-overrides.ts"
    if not title_path.exists() or not summary_path.exists():
        return Check("generated_feed_artifacts", "fail", "Generated title/summary override files are missing.", "Run pipeline/generate_title_overrides.py.")
    title_count = count_generated_entries(title_path)
    summary_count = count_generated_entries(summary_path)
    if title_count < 900 or summary_count < 900:
        return Check(
            "generated_feed_artifacts",
            "fail",
            f"title_count={title_count}; summary_count={summary_count}",
            "Regenerate overrides from the complete markdown corpus.",
        )
    return Check(
        "generated_feed_artifacts",
        "pass",
        f"title_count={title_count}; summary_count={summary_count}",
        metrics={"titleCount": title_count, "summaryCount": summary_count},
    )


def check_no_static_feed() -> Check:
    findings: list[str] = []
    for path in [ROOT / "web" / "app" / "page.tsx", ROOT / "web" / "lib" / "research-feed.ts"]:
        text = path.read_text(encoding="utf-8", errors="replace")
        if "RESEARCH_FEED" in text or "static CivilMCP research feed" in text:
            findings.append(str(path.relative_to(ROOT)))
    if findings:
        return Check("dynamic_feed_only", "fail", f"Static feed marker found in {findings}", "Remove static feed data and use /api/research-feed.")
    return Check("dynamic_feed_only", "pass", "No static feed markers found in primary feed surfaces.")


def check_reports_ignored() -> Check:
    text = (ROOT / ".gitignore").read_text(encoding="utf-8", errors="replace") if (ROOT / ".gitignore").exists() else ""
    if "harness/reports/" not in text:
        return Check("harness_reports_ignored", "fail", "harness/reports/ is not ignored.", "Add harness/reports/ to .gitignore.")
    return Check("harness_reports_ignored", "pass", "Harness reports are ignored as generated artifacts.")


def main() -> None:
    checks = [
        check_docs(),
        check_env_example(),
        check_secret_exposure(),
        check_mcp_tool_annotations(),
        check_agent_bounds_and_annotations(),
        check_backbone_guardrails(),
        check_generated_feed_artifacts(),
        check_no_static_feed(),
        check_reports_ignored(),
    ]
    report = make_report("invariants", checks)
    path = write_report("invariants", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
