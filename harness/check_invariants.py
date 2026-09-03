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
    "docs/WEBMCP_CHALLENGE_SUBMISSION.md",
]
REQUIRED_ENV_KEYS = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_ANON_KEY",
    "MCP_SERVER_API_KEY",
    "MCP_CLIENT_KEYS_JSON",
    "GUEST_SESSION_HMAC_KEY",
    "AGENTIC_CONTEXT_ENABLED",
    "FAST_RETRIEVAL_ENABLED",
    "FAST_RETRIEVAL_MAX_RESULTS",
    "LLM_ROUTER_ENABLED",
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
    "MCP_TOOL_TIMEOUT_MS",
    "MAX_ACTIVE_PATH_BUILDS",
    "MAX_ACTIVE_CHECKPOINTS",
    "MAX_ACTIVE_NOTEBOOK_ASKS",
    "OPENRAG_ADAPTER_ENABLED",
]
SERVER_SECRET_KEYS = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SUPABASE_SERVICE_KEY",
    "MCP_SERVER_API_KEY",
    "MCP_CLIENT_KEYS_JSON",
    "GUEST_SESSION_HMAC_KEY",
    "CIVILMCP_AUTOMATION_EVENT_KEY",
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
    "search_source_catalog",
    "find_related_papers",
    "list_source_providers",
    "search_global_research",
    "map_citation_network",
    "get_evidence_snapshot",
    "list_library_items",
    "list_private_sources",
    "fetch_private_source_pages",
]
EXPECTED_WRITE_TOOLS = {
    "save_library_item": "WRITE_ANNOTATIONS",
    "remove_library_item": "DELETE_ANNOTATIONS",
}
EXPECTED_WEBMCP_TOOLS = {
    "start_research_case",
    "discover_research",
    "audit_global_visibility",
    "inspect_paper_evidence",
    "trace_research_connections",
    "draft_research_passport",
    "build_research_path",
    "inspect_learning_progress",
}


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
    write_annotation_missing = [
        tool for tool, annotation in EXPECTED_WRITE_TOOLS.items()
        if not re.search(rf'"{re.escape(tool)}"\s*:\s*\{{[\s\S]*?"annotations"\s*:\s*{annotation}', text)
    ]
    if missing or annotation_missing or write_annotation_missing or "readOnlyHint" not in text or "destructiveHint" not in text:
        return Check(
            "mcp_tool_annotations",
            "fail",
            f"missing={missing}; annotation_missing={annotation_missing}; write_annotation_missing={write_annotation_missing}",
            "Ensure MCP tools declare the correct read, write, or destructive annotations.",
        )
    return Check("mcp_tool_annotations", "pass", "MCP tools declare explicit read, write, and destructive annotations.")


def check_webmcp_contract() -> Check:
    bridge_path = ROOT / "web" / "lib" / "webmcp.ts"
    page_path = ROOT / "web" / "app" / "page.tsx"
    e2e_path = ROOT / "web" / "tests" / "e2e" / "webmcp.spec.ts"
    path_route_path = ROOT / "web" / "app" / "api" / "research-path" / "route.ts"
    next_config_path = ROOT / "web" / "next.config.ts"
    if not bridge_path.exists() or not e2e_path.exists():
        return Check(
            "webmcp_contract",
            "fail",
            "WebMCP bridge or browser contract test is missing.",
            "Restore the top-level WebMCP bridge and its end-to-end execution test.",
        )
    bridge = bridge_path.read_text(encoding="utf-8", errors="replace")
    page = page_path.read_text(encoding="utf-8", errors="replace")
    e2e = e2e_path.read_text(encoding="utf-8", errors="replace")
    path_route = path_route_path.read_text(encoding="utf-8", errors="replace")
    next_config = next_config_path.read_text(encoding="utf-8", errors="replace")
    declared = set(re.findall(r'name:\s*"([a-z_]+)"', bridge))
    missing = sorted(EXPECTED_WEBMCP_TOOLS - declared)
    unexpected = sorted(declared - EXPECTED_WEBMCP_TOOLS)
    required_markers = {
        "browser_registration": "document.modelContext.registerTool" in bridge,
        "registration_cleanup": "AbortController" in bridge and "registration?.abort()" in page,
        "exact_tool_count": len(declared) == len(EXPECTED_WEBMCP_TOOLS),
        "strict_schemas": bridge.count("additionalProperties: false") >= len(EXPECTED_WEBMCP_TOOLS),
        "read_and_untrusted_hints": "readOnlyHint" in bridge and bridge.count("untrustedContentHint: true") >= len(EXPECTED_WEBMCP_TOOLS),
        "wired_to_page": "registerSeedResearchWebMcpTools(proxy)" in page and "SeedyMCP active · 8 site tools" in page,
        "fail_closed_connection_trace": all(
            marker in page
            for marker in (
                "traceResearchConnections: async",
                "isTraceableOpenAlexMatch(map.match)",
                "relations: relations.map",
                "metadata-only Global Research Leads",
                "Trace and review the active paper connections",
            )
        ) and (ROOT / "web" / "tests" / "e2e" / "openalex-connections.spec.ts").exists(),
        "active_visible_exact_page_evidence": all(
            marker in page
            for marker in (
                "webMcpEvidenceContextRef.current = { ...enrichedDetail, evidence: visibleEvidence }",
                "detail.evidence.slice(0, 8)",
                "activeDetail.document.source !== input.source",
                "Every evidenceId must be visible in the active paper.",
                "item.pageStart == null || item.pageEnd == null",
            )
        ) and "visible in the active paper" in e2e,
        "private_and_metadata_boundary": all(
            marker in page
            for marker in (
                'input.source.startsWith("private:")',
                "Private paper sources cannot be included in a public Research Passport.",
                'activeDetail.document.citable !== true || activeDetail.document.discoveryLayer === "thai_discovery"',
                "Discovery-only records cannot be used as Research Passport evidence.",
            )
        ) and "discovery-only" in e2e,
        "review_before_export_and_global_non_citable": all(
            marker in page
            for marker in (
                "artifact.openedEvidenceIds.includes(item.id)",
                "artifact.reviewDecisions[item.id]?.decision === \"accepted\"",
                "allEvidenceDecided",
                "Review the current Research Passport before exporting it.",
                "tracedGlobalWorks(connectionResponse)",
                'item.tool === "audit_global_visibility"',
                'receipt.state === "audit_unavailable"',
                "researchContextRevisionRef.current !== contextRevision",
                "const translationResponse = await translationRequest",
                "englishSnippet: englishByEvidenceId.get(item.id) ?? null",
                "globalLeadBasis",
                "citable: false",
                "global records used as evidence: 0",
            )
        ) and all(marker in e2e for marker in ("toBeDisabled()", 'name: "Accept", exact: true', "Complete evidence review", "toBeEnabled()", "citable).toBe(false)", "provider unavailable", "bounded English rendering")),
        "structured_research_path_artifacts": all(
            marker in path_route
            for marker in (
                "globalLeadSchema",
                'status: z.literal("candidate_unvalidated")',
                "noveltyEstablished: z.literal(false)",
                'status: z.literal("draft_framework")',
                "falsificationCondition",
                "SELECTED GLOBAL LEADS — METADATA ONLY, NEVER EVIDENCE",
                "fallbackResearchArtifacts",
            )
        ) and all(
            marker in page
            for marker in (
                "globalLeads: selectedGlobalLeads.map",
                "Candidate gap · not proven novel",
                "Next-Study Protocol — draft framework",
            )
        ) and all(marker in e2e for marker in ("W999999", "candidate_unvalidated", "draft_framework")),
        "webmcp_headers": "tools=(self)" in next_config and 'Origin-Agent-Cluster", value: "?1"' in next_config,
        "browser_execution_test": all(tool in e2e for tool in EXPECTED_WEBMCP_TOOLS) and ".execute(" in e2e,
    }
    failed = [name for name, present in required_markers.items() if not present]
    if missing or unexpected or failed:
        return Check(
            "webmcp_contract",
            "fail",
            f"missing_tools={missing}; unexpected_tools={unexpected}; failed={failed}",
            "Expose the bounded WebMCP tool suite from the top-level page and keep the execution test green.",
        )
    return Check(
        "webmcp_contract",
        "pass",
        "Eight bounded WebMCP tools are wired to a persistent Research Case with dated visibility audit, fail-closed connection matching, exact-page Passport evidence, claim-level review gating, annotations, cleanup, and browser execution coverage.",
    )


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
    translation_text = (ROOT / "web" / "app" / "api" / "paper-translation" / "route.ts").read_text(encoding="utf-8", errors="replace")
    research_path_text = (ROOT / "web" / "app" / "api" / "research-path" / "route.ts").read_text(encoding="utf-8", errors="replace")
    workspace_run_text = (ROOT / "web" / "app" / "api" / "research-workspaces" / "route.ts").read_text(encoding="utf-8", errors="replace")
    private_library_text = (ROOT / "web" / "app" / "api" / "private-library" / "route.ts").read_text(encoding="utf-8", errors="replace")
    living_review_text = (ROOT / "web" / "app" / "api" / "living-reviews" / "route.ts").read_text(encoding="utf-8", errors="replace")
    mcp_access_text = (ROOT / "web" / "app" / "api" / "mcp-access" / "route.ts").read_text(encoding="utf-8", errors="replace")
    schema_text = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8", errors="replace")
    auth_text = (ROOT / "web" / "lib" / "chat-auth.ts").read_text(encoding="utf-8", errors="replace")
    auth_route_text = (ROOT / "web" / "app" / "api" / "auth" / "route.ts").read_text(encoding="utf-8", errors="replace")
    cookie_text = (ROOT / "web" / "lib" / "chat-cookies.ts").read_text(encoding="utf-8", errors="replace")
    store_text = (ROOT / "web" / "lib" / "chat-store.ts").read_text(encoding="utf-8", errors="replace")
    history_text = (ROOT / "web" / "app" / "api" / "history" / "route.ts").read_text(encoding="utf-8", errors="replace")
    release_text = (ROOT / ".github" / "workflows" / "preview-release.yml").read_text(encoding="utf-8", errors="replace")
    page_text = (ROOT / "web" / "app" / "page.tsx").read_text(encoding="utf-8", errors="replace")
    mcp_requirements = (ROOT / "mcp-server" / "requirements.txt").read_text(encoding="utf-8", errors="replace")
    catalog_boundary = (ROOT / "supabase" / "migrations" / "20260813100000_civil_catalog_public_rights_boundary.sql").read_text(encoding="utf-8", errors="replace")
    native_scale = (ROOT / "supabase" / "migrations" / "20260902020000_civil_native_reader_scale_1000.sql").read_text(encoding="utf-8", errors="replace")
    account_deletion = (ROOT / "supabase" / "migrations" / "20260813110000_civil_transactional_account_deletion.sql").read_text(encoding="utf-8", errors="replace")
    mcp_units = (ROOT / "supabase" / "migrations" / "20260815150000_civil_mcp_research_units.sql").read_text(encoding="utf-8", errors="replace")
    billing_release_chain = [
        "20260720160000_civil_founder_pro.sql",
        "20260720163000_civil_billing_period_guards.sql",
        "20260725120000_civil_deepseek_default_and_pro_models.sql",
        "20260725203000_civil_free_weekly_credits.sql",
        "20260725205900_civil_founder_pro_500_credits.sql",
    ]
    billing_release_positions = [release_text.find(migration) for migration in billing_release_chain]
    required = {
        "mcp_transport_guard": "is_mounted_transport_request" in server_text and "record_transport" in server_text,
        "mcp_named_clients": "MCP_CLIENT_KEYS_JSON" in server_text and "enforce_mcp_rate_limit" in server_text,
        "mcp_sdk_compatibility_pin": "mcp>=1.9.0,<2" in mcp_requirements,
        "signed_guest_identity": "verifySignedGuestCookie" in cookie_text and "signedGuestIdFromRequest" in auth_text,
        "expired_auth_fail_closed": "ChatIdentityError" in auth_text and "hasSupabaseAuthCookie" in auth_text,
        "auth_anon_key_fail_closed": (
            'payload.role === "anon"' in auth_text
            and 'value.startsWith("sb_publishable_")' in auth_text
            and "process.env.SUPABASE_SERVICE_KEY" not in auth_text
        ),
        "transactional_account_deletion": (
            'admin.rpc("civil_delete_account_data"' in auth_route_text
            and auth_route_text.index('admin.rpc("civil_delete_account_data"')
            < auth_route_text.index("admin.auth.admin.deleteUser")
            and "security definer" in account_deletion
            and "grant execute on function public.civil_delete_account_data(text) to service_role" in account_deletion
            and "civil_delete_account_data" in schema_text
        ),
        "guest_secret_strength": (
            "assertGuestCookieConfigured" in chat_text
            and "configured.length >= 32" in cookie_text
            and 'deriveCivilSecurityKey("guest-session")' in cookie_text
            and 'update(`civilmcp:${purpose}:v1`)' in cookie_text
        ),
        "chat_rate_limit": "consumeChatQuota" in chat_text and "CHAT_GUEST_REQUESTS_PER_HOUR" in chat_text,
        "server_owned_credit_ids": (
            "const requestId = safeTraceId();" in chat_text
            and 'request.headers.get("x-request-id")' not in chat_text
            and "const billingExecutionId = safeTraceId();" in workspace_run_text
            and "`${billingExecutionId}:paper:${index + 1}`" in workspace_run_text
            and "`${parsed.data.runId}:paper:${index + 1}`" not in workspace_run_text
        ),
        "translation_distributed_quota": (
            "resolveChatIdentity" in translation_text
            and "consumeChatQuota" in translation_text
            and 'scope: "paper_translation"' in translation_text
            and "checkRateLimit(" not in translation_text
            and "requestIdentityKey(" not in translation_text
        ),
        "research_path_distributed_quota": (
            "resolveChatIdentity" in research_path_text
            and '"research_path_checkpoint"' in research_path_text
            and '"research_path"' in research_path_text
            and "consumeChatQuota" in research_path_text
        ),
        "private_library_owner_boundary": (
            "resolveChatIdentity" in private_library_text
            and "identity.isAuthenticated" in private_library_text
            and 'scope: "private_library_import"' in private_library_text
            and "civil_private_library_items" in schema_text
        ),
        "living_review_owner_boundary": (
            "resolveChatIdentity" in living_review_text
            and 'scope: "living_review_check"' in living_review_text
            and "civil_living_review_watches" in schema_text
        ),
        "personal_mcp_key_boundary": (
            "randomBytes(32)" in mcp_access_text
            and 'createHash("sha256")' in mcp_access_text
            and "civil_mcp_access_keys" in server_text
            and "cvmcp_" in server_text
            and "civil_mcp_access_keys" in schema_text
        ),
        "public_mcp_research_units": (
            "civil_consume_mcp_units" in server_text
            and 'request_id = f"mcp_{uuid.uuid4()}"' in server_text
            and "civil_refund_mcp_units" in server_text
            and "civil_mcp_usage_accounts" in schema_text
            and "civil_mcp_usage_ledger" in schema_text
            and "grant execute on function public.civil_consume_mcp_units(text, text, text) to service_role" in mcp_units
            and "revoke all on function public.civil_consume_mcp_units(text, text, text) from public, anon, authenticated" in mcp_units
            and 'client.rpc("civil_get_mcp_usage"' in mcp_access_text
        ),
        "metadata_abstract_public_boundary": (
            "search_civil_source_catalog_public_v1" in server_text
            and "search_civil_source_catalog_public_v1" in catalog_boundary
            and "Stored abstracts are intentionally omitted" in catalog_boundary
            and "search_civil_source_catalog_public_v2" in native_scale
            and "abstract_local text" not in native_scale
            and "abstract_en text" not in native_scale
        ),
        "native_reader_scale_1000": (
            release_text.count("20260902020000_civil_native_reader_scale_1000.sql") == 2
            and release_text.count("python harness/run_native_scale.py --strict") == 2
            and "search_civil_source_catalog_public_v2" in release_text
            and "native_first boolean" in native_scale
            and "civil_source_catalog_native_feed_idx" in native_scale
            and "civil_source_catalog_provider_native_feed_idx" in native_scale
            and "civil_fulltext_pages_asset_page_idx" in native_scale
        ),
        "bounded_evidence_feed_rpc": (
            "20260813140000_civil_bounded_evidence_feed.sql" in release_text
            and "list_civil_evidence_feed_v1" in (ROOT / "web" / "lib" / "research-feed.ts").read_text(encoding="utf-8", errors="replace")
            and "civil_evidence_feed_previews_v1" in (ROOT / "web" / "lib" / "research-feed.ts").read_text(encoding="utf-8", errors="replace")
        ),
        "distributed_quota_rpc": "consume_civil_quota" in schema_text,
        "backbone_readiness_rpc": "civil_backbone_readiness" in schema_text and '"/health/ready"' in server_text,
        "lexical_retrieval_fallback": all(
            marker in server_text
            for marker in ("search_civil_sections_lexical_v2", "search_civil_chunks_lexical_v2", "lexical_retrieval_fallback")
        ) and all(marker in schema_text for marker in ("civil_sections_v2_lexical_trgm_idx", "civil_chunks_v2_lexical_trgm_idx")),
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
        "public_support": (ROOT / "web" / "app" / "api" / "support" / "route.ts").exists()
        and "civil_support_requests" in schema_text,
        "product_events": (ROOT / "web" / "app" / "api" / "events" / "route.ts").exists()
        and "civil_product_events" in schema_text
        and '"x-civilmcp-eval"' in (ROOT / "web" / "app" / "api" / "events" / "route.ts").read_text(encoding="utf-8", errors="replace"),
        "privacy_and_account_deletion": all(
            (ROOT / "web" / "app" / route / "page.tsx").exists() for route in ("privacy", "terms", "support")
        ) and 'action: "delete-account"' in page_text,
        "data_quality_harness": (ROOT / "harness" / "run_data_quality.py").exists(),
        "staged_production_release": all(
            marker in release_text
            for marker in ("stage-production:", "production-candidate-smoke:", "--prod --skip-domain", "GA_PROMOTION_ENABLED")
        ),
        "release_billing_migration_chain": (
            all(position >= 0 for position in billing_release_positions)
            and billing_release_positions == sorted(billing_release_positions)
            and release_text.count("for migration in $CIVIL_BILLING_MIGRATIONS") == 2
            and release_text.count('-Atqc "$CIVIL_BILLING_STATE_SQL"') == 4
            and "civil_sync_stripe_subscription" in release_text
            and release_text.count("20260813120000_civil_stripe_event_idempotency.sql") == 2
            and release_text.count("20260814090000_civil_luna_free_credit_ladder.sql") == 2
            and release_text.count("20260814100000_civil_terra_sol_credit_correction.sql") == 2
            and release_text.count("20260815100000_civil_activation_events.sql") == 2
            and release_text.count("20260815110000_civil_private_library_and_watches.sql") == 2
            and release_text.count("20260815120000_civil_personal_mcp_access.sql") == 2
            and release_text.count("20260815130000_civil_mcp_v2_library.sql") == 2
            and release_text.count("20260815140000_civil_mcp_oauth_audience_hook.sql") == 2
            and release_text.count("20260815150000_civil_mcp_research_units.sql") == 2
            and release_text.count('-Atqc "$CIVIL_BILLING_HARDENING_SQL"') == 2
            and "civil_apply_stripe_subscription_event" in release_text
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


def check_product_contract() -> Check:
    models = (ROOT / "web" / "lib" / "chat-models.ts").read_text(encoding="utf-8", errors="replace")
    chat = (ROOT / "web" / "app" / "api" / "chat" / "route.ts").read_text(encoding="utf-8", errors="replace")
    translation = (ROOT / "web" / "app" / "api" / "paper-translation" / "route.ts").read_text(encoding="utf-8", errors="replace")
    page = (ROOT / "web" / "app" / "page.tsx").read_text(encoding="utf-8", errors="replace")
    research_path = (ROOT / "web" / "app" / "api" / "research-path" / "route.ts").read_text(encoding="utf-8", errors="replace")
    research_workspace = (ROOT / "web" / "app" / "api" / "research-workspaces" / "route.ts").read_text(encoding="utf-8", errors="replace")
    research_workspace_ui = (ROOT / "web" / "components" / "research-workspace.tsx").read_text(encoding="utf-8", errors="replace")
    research_notebook = (ROOT / "web" / "app" / "api" / "research-notebooks" / "route.ts").read_text(encoding="utf-8", errors="replace")
    research_notebook_ui = (ROOT / "web" / "components" / "research-notebook.tsx").read_text(encoding="utf-8", errors="replace")
    feed = (ROOT / "web" / "lib" / "research-feed.ts").read_text(encoding="utf-8", errors="replace")
    private_library = (ROOT / "web" / "app" / "api" / "private-library" / "route.ts").read_text(encoding="utf-8", errors="replace")
    living_reviews = (ROOT / "web" / "app" / "api" / "living-reviews" / "route.ts").read_text(encoding="utf-8", errors="replace")
    openalex = (ROOT / "web" / "lib" / "openalex.ts").read_text(encoding="utf-8", errors="replace")
    mcp_server = (ROOT / "mcp-server" / "server.py").read_text(encoding="utf-8", errors="replace")
    oauth_grants_text = (ROOT / "web" / "app" / "api" / "oauth-grants" / "route.ts").read_text(encoding="utf-8", errors="replace")
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8", errors="replace")
    release = (ROOT / ".github" / "workflows" / "preview-release.yml").read_text(encoding="utf-8", errors="replace")
    score = (ROOT / "harness" / "score_quality.py").read_text(encoding="utf-8", errors="replace")
    billing = (ROOT / "web" / "lib" / "billing.ts").read_text(encoding="utf-8", errors="replace")
    billing_migration = (ROOT / "supabase" / "migrations" / "20260720160000_civil_founder_pro.sql").read_text(encoding="utf-8", errors="replace")
    stripe_idempotency = (ROOT / "supabase" / "migrations" / "20260813120000_civil_stripe_event_idempotency.sql").read_text(encoding="utf-8", errors="replace")
    billing_period_guard = (ROOT / "supabase" / "migrations" / "20260720163000_civil_billing_period_guards.sql").read_text(encoding="utf-8", errors="replace")
    model_policy_migration = (ROOT / "supabase" / "migrations" / "20260725120000_civil_deepseek_default_and_pro_models.sql").read_text(encoding="utf-8", errors="replace")
    openai_default_migration = (ROOT / "supabase" / "migrations" / "20260829072758_default_openai_luna.sql").read_text(encoding="utf-8", errors="replace")
    credit_ladder_migration = (ROOT / "supabase" / "migrations" / "20260814100000_civil_terra_sol_credit_correction.sql").read_text(encoding="utf-8", errors="replace")
    public_mcp_v2_tools = set(re.findall(r'@_mcp_v2_tool_decorator\("([a-z_]+)"\)', mcp_server))
    expected_public_mcp_v2_tools = {
        "discover_research", "get_paper", "query_papers", "compare_papers",
        "map_citation_network", "get_evidence_snapshot", "list_library",
        "create_library_folder", "rename_library_folder", "delete_library_folder",
        "save_papers", "move_papers", "remove_papers", "list_private_sources",
    }
    required = {
        "openai_default": 'DEFAULT_CHAT_MODEL: ChatModel = "gpt-5.6-luna"' in models,
        "gpt_5_6_picker": all(model in models for model in ("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol")),
        "openai_router": "process.env.ROUTER_MODEL ?? DEFAULT_CHAT_MODEL" in chat,
        "openai_translation": "process.env.TRANSLATION_MODEL ?? DEFAULT_CHAT_MODEL" in translation,
        "gpt_5_6_open_access": all(
            marker in models
            for marker in (
                '"gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", credits: 1, requiresPro: false',
                '"gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", credits: 5, requiresPro: false',
                '"gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", credits: 10, requiresPro: false',
            )
        ),
        "deepseek_optional_open_access": all(
            marker in models
            for marker in (
                '"deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek", credits: 1, requiresPro: false',
                '"deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", credits: 2, requiresPro: false',
            )
        ),
        "open_access_policy": (
            (ROOT / "web" / "lib" / "product-access.ts").exists()
            and "CIVILMCP_OPEN_ACCESS" in billing
            and 'reason: "open_access"' in billing
            and "if (!CIVILMCP_OPEN_ACCESS" in chat
            and "CIVILMCP_OPEN_ACCESS" in research_workspace
            and "CIVILMCP_OPEN_ACCESS" in mcp_server
        ),
        "database_model_policy": "alter column model set default 'deepseek-v4-flash'" in model_policy_migration
        and "alter column model set default 'gpt-5.6-luna'" in openai_default_migration
        and all(marker in credit_ladder_migration for marker in (
            "when 'deepseek-v4-pro' then 2",
            "when 'gpt-5.6-terra' then 5",
            "when 'gpt-5.6-sol' then 10",
            "p_model in ('deepseek-v4-pro', 'gpt-5.6-terra', 'gpt-5.6-sol')",
        )),
        "provider_neutral_product_copy": "Powered by GPT" not in page and "Thai-published page-citable papers" in page,
        "guest_hour_quota": "CHAT_GUEST_REQUESTS_PER_HOUR, 1, 500, 30" in chat,
        "corpus_facets": all(marker in feed for marker in ("totalSections", "totalChunks")),
        "verified_corpus_fallback": all(
            marker in page
            for marker in (
                "feedThaiPublishedDiscoveryTotal",
                "feedThaiNativeFullPaperTotal",
                "feedThaiPublishedPageCitableTotal",
                "feedGlobalComparisonTotal",
                "visibility-audited works",
                "completed Research Cases",
            )
        ),
        "explicit_paper_routing": all(marker in chat for marker in ("explicitPaperSources", "fetch_civil_paper", "exactPaperMatches")),
        "demo_fast_retrieval": all(marker in chat for marker in (
            "FAST_RETRIEVAL_ENABLED", "LLM_ROUTER_ENABLED", "MCP_TOOL_TIMEOUT_MS",
            'callTool("search_civil_knowledge"',
        )),
        "city_directory": (ROOT / "citymcp" / "ops-dashboard").exists(),
        "city_ci": (ROOT / ".github" / "workflows" / "citymcp-ci.yml").exists(),
        "city_release": (ROOT / ".github" / "workflows" / "citymcp-release.yml").exists(),
        "civil_ci_isolated": "citymcp" not in ci.lower() and "ops-dashboard" not in ci,
        "civil_release_isolated": "citymcp" not in release.lower() and "ops-dashboard" not in release,
        "civil_score_isolated": "citymcp_ops_quality" not in score and "ops_quality_check" not in score,
        "build_week_evidence": (ROOT / "BUILD_WEEK.md").exists() and (ROOT / "DATA_SOURCES.md").exists(),
        "code_license": (ROOT / "LICENSE").exists(),
        "synthetic_fixture": (ROOT / "fixtures" / "synthetic-civil-paper.json").exists(),
        "atomic_credit_ledger": all(marker in billing_migration for marker in ("civil_credit_ledger", "for update", "civil_refund_answer_credits")),
        "verified_credit_refunds": all(
            marker in billing
            for marker in ("if (data !== true) throw new Error", "Answer credit restoration was not confirmed")
        ) and all(
            marker in chat
            for marker in ("civilmcp_credit_refund_pending", "Credit restoration is pending. Contact support with trace")
        ) and all(
            marker in research_workspace
            for marker in ("restoreWorkspaceCredits", "Credit restoration is pending. Contact support with trace")
        ),
        "stripe_event_idempotency": all(
            marker in stripe_idempotency
            for marker in (
                "civil_stripe_event_ledger",
                "on conflict (event_id) do nothing",
                "p_event_created_at = v_account.stripe_event_created_at",
                "p_event_id <= coalesce(v_account.stripe_event_id, '')",
            )
        ) and 'rpc("civil_apply_stripe_subscription_event"' in billing,
        "expired_pro_downgrade": all(marker in billing_period_guard for marker in ("civil_expire_billing_account", "plan = 'free'", "current_period_end <= clock_timestamp()")),
        "signed_stripe_webhook": "timingSafeEqual(received, expected)" in billing,
        "agentic_evidence_mission": all(
            marker in chat
            for marker in (
                'type ChatExperience = "answer" | "mission" | "learn" | "research" | "automated"',
                "generateMissionArtifact",
                "finalizeMissionArtifact",
                'type: "civilmcp_mission"',
            )
        ),
        "mission_product_surface": all(
            marker in page
            for marker in (
                'value: "mission"',
                'label: "Evidence Review"',
                "AgenticMissionCard",
                "evidenceBriefMarkdown",
                "openPaperDetailBySource",
            )
        ),
        "personalized_research_path": all(
            marker in research_path
            for marker in (
                "civilmcp-research-path-v2", "Map the Thai field", "Frame the gap and next study", "discoverOpenAlex", "knowledgeGaps",
                'z.literal("assess_checkpoint")', "checkpointResultSchema", "getPaperDetail", "CHECKPOINT_MODEL",
                'score >= 75 ? "understood"', "ALLOW-LISTED EVIDENCE",
                "includeFacets: false", "MAX_ACTIVE_PATH_BUILDS", "gradeAvailable: false",
            )
        ) and all(marker in page for marker in (
            "PersonalizedResearchPathPanel", 'label: "Research Path"',
            "ResearchPathCheckpointAssessment", "onOpenEvidence", "adaptResearchPath",
            "preserveMastered", "Export cited path", "seed-research-path-",
        )) and any(marker in page for marker in ("Check against evidence", "Check understanding")),
        "private_project_library": all(
            marker in private_library for marker in ("extractPdf", "crossrefMetadata", 'scope: "private_library_import"', "12 * 1024 * 1024", "300_000")
        ) and "Private Project Library" in research_workspace_ui,
        "living_review": all(marker in living_reviews for marker in ("resultKeys", "createLivingReviewWatch", 'scope: "living_review_check"'))
        and "LivingReviewPanel" in page,
        "citation_map": all(marker in openalex for marker in ("citationMapOpenAlex", "titleSimilarity", "requiresHumanReview"))
        and (ROOT / "web" / "app" / "api" / "citation-map" / "route.ts").exists()
        and "Thai-to-global connection map" in page,
        "public_paper_pages": (ROOT / "web" / "app" / "papers" / "[source]" / "page.tsx").exists(),
        "personal_mcp_parity": all(
            marker in mcp_server
            for marker in ("search_global_research", "map_citation_network", "get_evidence_snapshot", "save_library_item", "list_private_sources", "fetch_private_source_pages")
        ) and (ROOT / "web" / "app" / "api" / "mcp-access" / "route.ts").exists(),
        "public_mcp_v2": (
            public_mcp_v2_tools == expected_public_mcp_v2_tools
            and 'app.mount("/v2"' in mcp_server
            and "stateless_http=True" in mcp_server
            and "civil_mcp_access_token_hook" in (ROOT / "supabase" / "migrations" / "20260815140000_civil_mcp_oauth_audience_hook.sql").read_text(encoding="utf-8")
            and "civil_mcp_library_folders" in (ROOT / "supabase" / "migrations" / "20260815130000_civil_mcp_v2_library.sql").read_text(encoding="utf-8")
            and all(marker in oauth_grants_text for marker in ("listGrants", "revokeGrant"))
            and (ROOT / "web" / "app" / "oauth" / "consent" / "page.tsx").exists()
            and (ROOT / "web" / "app" / "developers" / "page.tsx").exists()
        ),
        "deep_research_open_access": all(
            marker in chat for marker in ('experience === "research"', "!CIVILMCP_OPEN_ACCESS")
        ) and all(marker in page for marker in ('label: "Deep Research"', 'badge: "OpenAI"')),
        "automated_research_workspace": all(
            marker in research_workspace
            for marker in (
                'rows: z.array(workspaceRowSchema).min(1).max(6)',
                'columns: z.array(workspaceColumnSchema).min(1).max(6)',
                "!CIVILMCP_OPEN_ACCESS",
                "reserveAnswerCredits",
                "refundAnswerCredits",
                '`P${paperIndex + 1}E${evidenceIndex + 1}`',
                "id.startsWith(prefix)",
                'scope: "research_workspace_run"',
            )
        ) and "Open Access Research Workspace" in research_workspace_ui
        and all(
            marker in research_workspace_ui
            for marker in (
                "Run selected",
                "Exact-page evidence",
                "Export CSV",
                "Verified",
            )
        ) and all(marker in research_notebook for marker in (
            "MAX_RETRIEVAL_PACKETS", "appendNotebookExchange", "saveNotebookArtifact",
            'scope: "research_notebook_light"', "Seedy Research Notebook running in resource-bounded Light Mode",
        )) and all(marker in research_notebook_ui for marker in (
            "Seedy Light Retrieval active", "Notebook sources", "Notebook Studio", "Workspace Evidence Packs",
        )) and all(marker in page for marker in ('label: "Workspace"', 'label: "Notebook"', "ResearchWorkspacePanel", "ResearchNotebookPanel")),
    }
    missing = [name for name, present in required.items() if not present]
    if missing:
        return Check("product_contract", "fail", f"missing={missing}", "Restore the approved product, model, and release contract.")
    return Check("product_contract", "pass", "OpenAI-first Open Access, assessed learning, corpus proof, data rights, and Civil/City boundaries are present.")


def check_no_static_feed() -> Check:
    findings: list[str] = []
    for path in [ROOT / "web" / "app" / "page.tsx", ROOT / "web" / "lib" / "research-feed.ts"]:
        text = path.read_text(encoding="utf-8", errors="replace")
        if "RESEARCH_FEED" in text or "static CivilMCP research feed" in text:
            findings.append(str(path.relative_to(ROOT)))
    if findings:
        return Check("dynamic_feed_only", "fail", f"Static feed marker found in {findings}", "Remove static feed data and use /api/research-feed.")
    return Check("dynamic_feed_only", "pass", "No static feed markers found in primary feed surfaces.")


def check_research_case_contract() -> Check:
    benchmark_path = ROOT / "harness" / "challenge_research_benchmark.json"
    lighthouse_path = ROOT / "harness" / "lighthouse_research_cases.json"
    migration_path = ROOT / "supabase" / "migrations" / "20260902221100_research_cases_and_thai_published_facets.sql"
    required_paths = [
        benchmark_path,
        lighthouse_path,
        migration_path,
        ROOT / "harness" / "run_challenge_research_benchmark.py",
        ROOT / "web" / "app" / "api" / "research-cases" / "route.ts",
        ROOT / "web" / "app" / "api" / "visibility-corrections" / "route.ts",
    ]
    missing_paths = [str(path.relative_to(ROOT)) for path in required_paths if not path.exists()]
    if missing_paths:
        return Check("research_case_contract", "fail", f"missing={missing_paths}", "Restore the persistent Research Case and benchmark artifacts.")
    benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))
    lighthouse = json.loads(lighthouse_path.read_text(encoding="utf-8"))
    cases = benchmark.get("cases", [])
    answerable = [case for case in cases if case.get("kind") == "answerable"]
    sparse = [case for case in cases if case.get("kind") == "sparse"]
    disciplines = {case.get("discipline") for case in answerable}
    migration = migration_path.read_text(encoding="utf-8", errors="replace")
    page = (ROOT / "web" / "app" / "page.tsx").read_text(encoding="utf-8", errors="replace")
    contract_ok = (
        len(cases) == 30
        and len(answerable) == 20
        and len(sparse) == 10
        and {"engineering", "education", "health_social_science"}.issubset(disciplines)
        and len(lighthouse.get("cases", [])) == 3
        and all(marker in migration for marker in (
            "civil_research_cases", "civil_research_case_reviews", "civil_visibility_correction_suggestions",
            "thai_published boolean", "thailand_context boolean", "thai_language boolean", "thai_affiliated boolean",
            "enable row level security", "to service_role",
        ))
        and all(marker in page for marker in (
            "ResearchCasePanel", "startResearchCase", "reviewDecisions", "Complete evidence review", "Suggest match/correction",
        ))
        and all(marker in (ROOT / "web" / "lib" / "research-cases.ts").read_text(encoding="utf-8", errors="replace") for marker in (
            "getPaperDetail(input.source", "detail?.evidence.find", "verifiedPageAnchor !== input.pageAnchor",
        ))
    )
    if not contract_ok:
        return Check(
            "research_case_contract",
            "fail",
            f"cases={len(cases)}; answerable={len(answerable)}; sparse={len(sparse)}; disciplines={sorted(d for d in disciplines if d)}",
            "Restore the 20+10 benchmark, three Lighthouse cases, persistence, facets, and claim-level review boundary.",
        )
    return Check("research_case_contract", "pass", "Persistent Research Case, independent Thai facets, claim review, steward queue, 20+10 benchmark, and three Lighthouse cases are present.")


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
        check_webmcp_contract(),
        check_agent_bounds_and_annotations(),
        check_backbone_guardrails(),
        check_generated_feed_artifacts(),
        check_product_contract(),
        check_research_case_contract(),
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
