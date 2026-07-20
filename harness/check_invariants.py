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
    "MCP_CLIENT_KEYS_JSON",
    "GUEST_SESSION_HMAC_KEY",
    "AGENTIC_CONTEXT_ENABLED",
    "ROUTER_PROVIDER",
    "ROUTER_MODEL",
    "MAX_AGENT_STEPS",
    "MAX_TOOL_CALLS",
    "MAX_CONTEXT_CHUNKS",
    "MAX_CONTEXT_TOKENS",
    "CHAT_MAX_BODY_BYTES",
    "CHAT_GUEST_REQUESTS_PER_MINUTE",
    "CHAT_GUEST_REQUESTS_PER_HOUR",
    "CHAT_AUTH_REQUESTS_PER_MINUTE",
    "CHAT_AUTH_REQUESTS_PER_HOUR",
    "ANSWER_MAX_TOKENS",
]
SERVER_SECRET_KEYS = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SUPABASE_SERVICE_KEY",
    "MCP_SERVER_API_KEY",
    "MCP_CLIENT_KEYS_JSON",
    "GUEST_SESSION_HMAC_KEY",
]
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
    if path.suffix == ".json":
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return 0
        return len(payload) if isinstance(payload, dict) else 0
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
        "civilmcp_mission",
        "MissionArtifactSchema",
        "uniqueValidEvidenceIds",
        "createDataStreamResponse",
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
    auth_text = (ROOT / "web" / "lib" / "chat-auth.ts").read_text(encoding="utf-8", errors="replace")
    cookie_text = (ROOT / "web" / "lib" / "chat-cookies.ts").read_text(encoding="utf-8", errors="replace")
    store_text = (ROOT / "web" / "lib" / "chat-store.ts").read_text(encoding="utf-8", errors="replace")
    history_text = (ROOT / "web" / "app" / "api" / "history" / "route.ts").read_text(encoding="utf-8", errors="replace")
    release_text = (ROOT / ".github" / "workflows" / "preview-release.yml").read_text(encoding="utf-8", errors="replace")
    required = {
        "mcp_transport_guard": "is_mounted_transport_request" in server_text and "record_transport" in server_text,
        "mcp_named_clients": "MCP_CLIENT_KEYS_JSON" in server_text and "enforce_mcp_rate_limit" in server_text,
        "signed_guest_identity": "verifySignedGuestCookie" in cookie_text and "signedGuestIdFromRequest" in auth_text,
        "expired_auth_fail_closed": "ChatIdentityError" in auth_text and "hasSupabaseAuthCookie" in auth_text,
        "guest_secret_strength": (
            "assertGuestCookieConfigured" in chat_text
            and "configured.length >= 32" in cookie_text
            and 'deriveCivilSecurityKey("guest-session")' in cookie_text
            and 'update(`civilmcp:${purpose}:v1`)' in cookie_text
        ),
        "chat_rate_limit": "consumeChatQuota" in chat_text and "CHAT_GUEST_REQUESTS_PER_HOUR" in chat_text,
        "distributed_quota_rpc": "consume_civil_quota" in schema_text,
        "backbone_readiness_rpc": "civil_backbone_readiness" in schema_text and '"/health/ready"' in server_text,
        "chat_body_cap": "readBoundedJson" in chat_text and "CHAT_MAX_BODY_BYTES" in chat_text,
        "history_write_bounds": "readBoundedJson" in history_text and "HISTORY_MAX_MESSAGES" in history_text,
        "lazy_guest_persistence": "createEmptyChatSession" in history_text and "storedUser ??" in auth_text,
        "trace_annotation": "traceId" in chat_text and "civilmcp_trace" in chat_text,
        "trace_table": "civil_chat_traces" in schema_text,
        "feedback_table": "civil_chat_feedback" in schema_text,
        "trace_metadata_mode": "question_hash" in schema_text and "retention_expires_at" in schema_text,
        "trace_metadata_redaction": "metadataOnlyTraceValue" in store_text,
        "feedback_owner_validation": '.eq("user_id", feedback.userId)' in store_text,
        "share_expiry": "share_expires_at" in schema_text and "share_revoked_at" in schema_text,
        "workspace_table": "civil_paper_workspace_items" in schema_text,
        "feedback_api": (ROOT / "web" / "app" / "api" / "feedback" / "route.ts").exists(),
        "data_quality_harness": (ROOT / "harness" / "run_data_quality.py").exists(),
        "staged_production_release": all(
            marker in release_text
            for marker in ("stage-production:", "production-candidate-smoke:", "--prod --skip-domain", "GA_PROMOTION_ENABLED")
        ),
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
    title_path = ROOT / "web" / "lib" / "paper-title-overrides.json"
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


def check_build_week_contract() -> Check:
    models = (ROOT / "web" / "lib" / "chat-models.ts").read_text(encoding="utf-8", errors="replace")
    chat = (ROOT / "web" / "app" / "api" / "chat" / "route.ts").read_text(encoding="utf-8", errors="replace")
    translation = (ROOT / "web" / "app" / "api" / "paper-translation" / "route.ts").read_text(encoding="utf-8", errors="replace")
    page = (ROOT / "web" / "app" / "page.tsx").read_text(encoding="utf-8", errors="replace")
    research_path = (ROOT / "web" / "app" / "api" / "research-path" / "route.ts").read_text(encoding="utf-8", errors="replace")
    feed = (ROOT / "web" / "lib" / "research-feed.ts").read_text(encoding="utf-8", errors="replace")
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8", errors="replace")
    release = (ROOT / ".github" / "workflows" / "preview-release.yml").read_text(encoding="utf-8", errors="replace")
    score = (ROOT / "harness" / "score_quality.py").read_text(encoding="utf-8", errors="replace")
    billing = (ROOT / "web" / "lib" / "billing.ts").read_text(encoding="utf-8", errors="replace")
    billing_migration = (ROOT / "supabase" / "migrations" / "20260720160000_civil_founder_pro.sql").read_text(encoding="utf-8", errors="replace")
    billing_period_guard = (ROOT / "supabase" / "migrations" / "20260720163000_civil_billing_period_guards.sql").read_text(encoding="utf-8", errors="replace")
    required = {
        "luna_default": 'DEFAULT_CHAT_MODEL: ChatModel = "gpt-5.6-luna"' in models,
        "gpt_5_6_picker": all(model in models for model in ("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol")),
        "luna_router": 'process.env.ROUTER_MODEL ?? "gpt-5.6-luna"' in chat,
        "luna_translation": '"gpt-5.6-luna"' in translation,
        "guest_hour_quota": "CHAT_GUEST_REQUESTS_PER_HOUR, 1, 500, 30" in chat,
        "corpus_facets": all(marker in feed for marker in ("totalSections", "totalChunks")),
        "verified_corpus_fallback": all(marker in page for marker in ("941", "48_370", "Exact-page citations")),
        "explicit_paper_routing": all(marker in chat for marker in ("explicitPaperSources", "fetch_civil_paper", "exactPaperMatches")),
        "city_directory": (ROOT / "citymcp" / "ops-dashboard").exists(),
        "city_ci": (ROOT / ".github" / "workflows" / "citymcp-ci.yml").exists(),
        "city_release": (ROOT / ".github" / "workflows" / "citymcp-release.yml").exists(),
        "civil_ci_isolated": "citymcp" not in ci.lower() and "ops-dashboard" not in ci,
        "civil_release_isolated": "citymcp" not in release.lower() and "ops-dashboard" not in release,
        "civil_score_isolated": "citymcp_ops_quality" not in score and "ops_quality_check" not in score,
        "build_week_evidence": (ROOT / "BUILD_WEEK.md").exists() and (ROOT / "DATA_SOURCES.md").exists(),
        "code_license": (ROOT / "LICENSE").exists(),
        "synthetic_fixture": (ROOT / "fixtures" / "synthetic-civil-paper.json").exists(),
        "pro_model_gate": all(marker in models for marker in ("credits: 3, requiresPro: true", "credits: 5, requiresPro: true")),
        "atomic_credit_ledger": all(marker in billing_migration for marker in ("civil_credit_ledger", "for update", "civil_refund_answer_credits")),
        "expired_pro_downgrade": all(marker in billing_period_guard for marker in ("civil_expire_billing_account", "plan = 'free'", "current_period_end <= clock_timestamp()")),
        "signed_stripe_webhook": "timingSafeEqual(received, expected)" in billing,
        "agentic_evidence_mission": all(
            marker in chat
            for marker in (
                'type ChatExperience = "answer" | "mission" | "learn" | "research"',
                "generateMissionArtifact",
                "finalizeMissionArtifact",
                'type: "civilmcp_mission"',
            )
        ),
        "mission_product_surface": all(
            marker in page
            for marker in (
                'value: "mission"',
                'label: "Evidence Mission"',
                "AgenticMissionCard",
                "evidenceBriefMarkdown",
                "openPaperDetailBySource",
            )
        ),
        "personalized_research_path": all(
            marker in research_path
            for marker in ("civilmcp-research-path-v1", "Map the field", "openAlexBridge", "readBoundedJson")
        ) and all(marker in page for marker in ("PersonalizedResearchPathPanel", 'label: "Research Path"')),
        "deep_research_pro_gate": all(
            marker in chat
            for marker in ('experience === "research"', "getBillingState(userId)", 'billingState.plan !== "founder_pro"')
        ) and all(marker in page for marker in ('label: "Deep Research"', "Deep Research is included in Founder Pro")),
    }
    missing = [name for name, present in required.items() if not present]
    if missing:
        return Check("build_week_product_contract", "fail", f"missing={missing}", "Restore the approved Build Week product and release contract.")
    return Check("build_week_product_contract", "pass", "Luna, corpus proof, data rights, and Civil/City release boundaries are present.")


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
        check_build_week_contract(),
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
