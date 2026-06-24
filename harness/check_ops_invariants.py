from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

from common import ROOT, Check, make_report, print_report, write_report
from check_invariants import (
    check_agent_bounds_and_annotations,
    check_docs,
    check_env_example,
    check_generated_feed_artifacts,
    check_mcp_tool_annotations,
    check_no_static_feed,
    check_reports_ignored,
    check_secret_exposure,
)

OPS_ROOT = ROOT / "ops-dashboard"
OPS_API_ROOT = OPS_ROOT / "app" / "api" / "ops"
SUPABASE_ROOT = ROOT / "supabase"

SERVER_SECRET_KEYS = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "SUPABASE_SERVICE_KEY",
    "MCP_SERVER_API_KEY",
    "OPS_INGEST_SECRET",
    "SMART_CITY_DATA_GOTH_API_KEY",
    "OPS_DASHBOARD_BASIC_AUTH_PASSWORD",
]

OPS_REQUIRED_ENDPOINTS = [
    "overview",
    "layers/registry",
    "layers",
    "ontology/objects",
    "insights",
    "rail/overview",
    "actions/log",
    "actions/record",
    "actions/[id]/transition",
    "commands/execute",
    "commands/log",
    "commands/[id]",
    "ingest/refresh",
    "sources/sla",
    "tiles/[z]/[x]/[y]",
    "research-gate",
]

READ_MODEL_TABLES = [
    "smart_city_sources",
    "smart_city_source_health",
    "smart_city_assets",
    "smart_city_events",
    "smart_city_hotspots",
    "smart_city_objects",
    "smart_city_links",
    "smart_city_insights",
    "smart_city_research_runs",
    "smart_city_research_evidence",
    "smart_city_research_proposals",
    "smart_city_action_records",
    "smart_city_action_events",
    "smart_city_command_batches",
    "smart_city_commands",
    "smart_city_command_events",
    "smart_city_ingest_runs",
    "smart_city_ingest_run_sources",
]

IGNORED_PARTS = {"node_modules", ".next", ".local", ".vercel"}


def source_files(root: Path, suffixes: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".sql", ".md", ".example")) -> list[Path]:
    if not root.exists():
        return []
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or any(part in IGNORED_PARTS for part in path.parts):
            continue
        if path.suffix in suffixes or path.name.endswith(".example"):
            files.append(path)
    return files


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def missing_strings(text: str, required: Iterable[str]) -> list[str]:
    return [item for item in required if item not in text]


def check_ops_dashboard_isolation() -> Check:
    required_files = [
        OPS_ROOT / "README.md",
        OPS_ROOT / "app" / "page.tsx",
        OPS_ROOT / "components" / "TransportOpsDashboard.tsx",
        OPS_API_ROOT / "overview" / "route.ts",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required_files if not path.exists()]
    missing_endpoints = [
        endpoint
        for endpoint in OPS_REQUIRED_ENDPOINTS
        if not (OPS_API_ROOT / endpoint / "route.ts").exists()
    ]

    web_findings: list[str] = []
    web_root = ROOT / "web"
    for path in source_files(web_root, (".ts", ".tsx")):
        text = read(path)
        if any(marker in text for marker in ["/api/ops", "smart_city_", "TransportOpsDashboard", "OPS_DASHBOARD"]):
            web_findings.append(str(path.relative_to(ROOT)))

    ops_findings: list[str] = []
    for path in source_files(OPS_ROOT, (".ts", ".tsx", ".md")):
        text = read(path)
        if re.search(r'from\s+["\'][^"\']*\.\./web|["\']\.\./web|web/app/api/chat|/api/chat', text):
            ops_findings.append(str(path.relative_to(ROOT)))

    if missing or missing_endpoints or web_findings or ops_findings:
        return Check(
            "ops_dashboard_isolation",
            "fail",
            f"missing={missing}; missing_endpoints={missing_endpoints}; web_findings={web_findings[:8]}; ops_findings={ops_findings[:8]}",
            "Keep ops-dashboard as a separate app and keep web/chatbot free of ops routes, smart_city tables, and dashboard imports.",
        )
    return Check("ops_dashboard_isolation", "pass", "Ops dashboard is present and isolated from web/chatbot surfaces.")


def check_ops_server_secret_boundary() -> Check:
    if not OPS_ROOT.exists():
        return Check("ops_server_secret_boundary", "fail", "ops-dashboard is missing.", "Restore the isolated ops-dashboard app.")

    findings: list[str] = []
    next_public_patterns = [f"NEXT_PUBLIC_{key}" for key in SERVER_SECRET_KEYS]
    for path in source_files(OPS_ROOT):
        text = read(path)
        for marker in next_public_patterns:
            if marker in text:
                findings.append(f"{path.relative_to(ROOT)} exposes {marker}")

    client_findings: list[str] = []
    for path in source_files(OPS_ROOT, (".ts", ".tsx")):
        text = read(path)
        if not re.match(r'^\s*["\']use client["\'];?', text):
            continue
        leaked = [key for key in SERVER_SECRET_KEYS if key in text or f"process.env.{key}" in text]
        if leaked:
            client_findings.append(f"{path.relative_to(ROOT)} references {sorted(set(leaked))}")

    required_server_files = [
        OPS_ROOT / "lib" / "mcp.ts",
        OPS_ROOT / "lib" / "spatial-read-model.ts",
        OPS_ROOT / "lib" / "action-log.ts",
        OPS_ROOT / "lib" / "action-recording-gate.ts",
        OPS_ROOT / "lib" / "action-lifecycle.ts",
        OPS_ROOT / "lib" / "command-audit.ts",
        OPS_ROOT / "lib" / "ops-auth.ts",
        OPS_ROOT / "lib" / "ingest-auth.ts",
    ]
    missing_server_files = [str(path.relative_to(ROOT)) for path in required_server_files if not path.exists()]

    if findings or client_findings or missing_server_files:
        return Check(
            "ops_server_secret_boundary",
            "fail",
            f"next_public={findings[:8]}; client_findings={client_findings[:8]}; missing_server_files={missing_server_files}",
            "Keep service-role, MCP, ingest, and basic-auth secrets in server-only ops code and never under NEXT_PUBLIC_*.",
        )
    return Check("ops_server_secret_boundary", "pass", "Ops server secrets stay out of browser-exposed envs and client components.")


def check_ops_ingest_auth_guard() -> Check:
    route = OPS_API_ROOT / "ingest" / "refresh" / "route.ts"
    auth = OPS_ROOT / "lib" / "ingest-auth.ts"
    middleware = OPS_ROOT / "middleware.ts"
    if not route.exists() or not auth.exists() or not middleware.exists():
        return Check("ops_ingest_auth_guard", "fail", "Ingest route, auth helper, or middleware is missing.", "Restore the guarded ingest refresh endpoint.")

    route_text = read(route)
    auth_text = read(auth)
    middleware_text = read(middleware)
    required_route = [
        "configuredIngestSecret()",
        "isAuthorizedIngestRequest(request)",
        "Unauthorized ingest refresh",
        "{ status: 401 }",
        "{ status: 503 }",
        "refreshSpatialCoreReadModel()",
        "export async function POST",
        "export async function GET",
        "cronSchedule",
    ]
    required_auth = [
        "OPS_INGEST_SECRET",
        "CRON_SECRET",
        "authorization",
        "x-ops-ingest-secret",
        "Bearer",
        "return false",
    ]
    required_middleware = [
        "/api/ops/ingest/refresh",
        "isAuthorizedIngestRefresh(request)",
        "OPS_INGEST_SECRET",
        "CRON_SECRET",
        "x-ops-ingest-secret",
        "Bearer",
    ]
    missing = (
        missing_strings(route_text, required_route)
        + missing_strings(auth_text, required_auth)
        + missing_strings(middleware_text, required_middleware)
    )
    if missing:
        return Check(
            "ops_ingest_auth_guard",
            "fail",
            f"missing={missing}",
            "Require OPS_INGEST_SECRET or CRON_SECRET and reject unauthenticated ingest refresh requests before any read-model write.",
        )
    return Check("ops_ingest_auth_guard", "pass", "Spatial ingest refresh is guarded for manual POST and Vercel Cron GET.")


def check_ops_action_record_research_guard() -> Check:
    action_route = OPS_API_ROOT / "actions" / "record" / "route.ts"
    action_gate = OPS_ROOT / "lib" / "action-recording-gate.ts"
    action_log = OPS_ROOT / "lib" / "action-log.ts"
    research_gate = OPS_API_ROOT / "research-gate" / "route.ts"
    evidence_gate = OPS_ROOT / "lib" / "research-gate-evidence.ts"
    rail_execute = OPS_API_ROOT / "rail" / "execute" / "route.ts"
    missing_files = [str(path.relative_to(ROOT)) for path in [action_route, action_gate, action_log, research_gate, evidence_gate, rail_execute] if not path.exists()]
    if missing_files:
        return Check("ops_action_record_research_guard", "fail", f"missing={missing_files}", "Restore action and research-gate guard files.")

    action_text = read(action_route)
    action_gate_text = read(action_gate)
    log_text = read(action_log)
    gate_text = read(research_gate)
    evidence_text = read(evidence_gate)
    rail_execute_text = read(rail_execute)
    required = [
        (action_text, "researchRunId"),
        (action_text, "proposalId"),
        (action_text, "getOpsActor"),
        (action_text, "requireOpsPermission"),
        (action_text, "actor is derived server-side"),
        (action_text, "recordPersistedResearchAction"),
        (action_gate_text, "getPersistedResearchProposal"),
        (action_gate_text, "readActionSourceObjects"),
        (action_gate_text, 'id.startsWith("mcp:")'),
        (action_gate_text, "All sourceObjectIds must exist in the current real-data ontology read model."),
        (action_gate_text, "Action records require a persisted mcp_read_only Research Gate run."),
        (action_gate_text, "Required action acknowledgements are missing."),
        (log_text, "validateActionRecordInput(input)"),
        (log_text, "Synthetic/mock/seed/static/fallback objects are not executable"),
        (log_text, 'executionScope: "controlled_action_record"'),
        (rail_execute_text, "recordPersistedResearchAction"),
        (rail_execute_text, "Client-supplied railCase/proposal payloads are not trusted."),
        (gate_text, "bindResearchGateResponseForPersistence"),
        (gate_text, "persistResearchGateRun"),
        (gate_text, "CivilMCP Analyst requires a real-source insight with provenance evidence."),
        (gate_text, "searchTransportEvidence"),
        (gate_text, "actionableEvidenceIds"),
        (gate_text, "recommendedActions = buildProposal(insight, actionableCitations, evidenceUse)"),
        (evidence_text, 'evidenceStrength !== "context_only"'),
        (evidence_text, "Only direct/indirect citations can support a recorded action."),
    ]
    missing = [needle for text, needle in required if needle not in text]
    forbidden = []
    if "createActionRecord" in rail_execute_text:
        forbidden.append("rail/execute imports or calls createActionRecord directly")
    if missing:
        return Check(
            "ops_action_record_research_guard",
            "fail",
            f"missing={missing}; forbidden={forbidden}",
            "Require source objects, mcp:* evidence, direct/indirect research evidence, and controlled action record scope before recording actions.",
        )
    if forbidden:
        return Check(
            "ops_action_record_research_guard",
            "fail",
            f"forbidden={forbidden}",
            "Route every action-writing path through the persisted Research Gate action-recording gate.",
        )
    return Check("ops_action_record_research_guard", "pass", "Action records require real objects plus cited CivilMCP research/evidence gates.")


def check_ops_real_data_only_guards() -> Check:
    guard_files = [
        OPS_ROOT / "lib" / "ontology.ts",
        OPS_ROOT / "lib" / "action-log.ts",
        OPS_ROOT / "lib" / "action-recording-gate.ts",
        OPS_API_ROOT / "research-gate" / "route.ts",
    ]
    missing_files = [str(path.relative_to(ROOT)) for path in guard_files if not path.exists()]
    if missing_files:
        return Check("ops_real_data_only_guards", "fail", f"missing={missing_files}", "Restore synthetic-marker guards.")

    findings: list[str] = []
    for path in guard_files:
        text = read(path)
        if not re.search(r"mock\|seed\|synthetic\|pilot", text):
            findings.append(f"{path.relative_to(ROOT)} missing synthetic marker regex")
        if path.name == "route.ts" and "real-data-only" not in text and "real-source" not in text:
            findings.append(f"{path.relative_to(ROOT)} missing real-data-only error language")

    source_text = read(OPS_ROOT / "lib" / "source-adapters.ts") if (OPS_ROOT / "lib" / "source-adapters.ts").exists() else ""
    rail_text = read(OPS_ROOT / "lib" / "rail-adapters.ts") if (OPS_ROOT / "lib" / "rail-adapters.ts").exists() else ""
    required_source_markers = [
        "Thailand real-data-only",
        '"needs_config"',
        "deriveHotspotsFromEvents(events)",
    ]
    required_rail_markers = [
        '"needs_config"',
        "process.env.SMART_CITY_RAIL_CROSSING_GEOJSON_URL",
        "process.env.SMART_CITY_RAIL_NEWS_FEED_URL",
    ]
    findings.extend(f"source-adapters missing {item}" for item in missing_strings(source_text, required_source_markers))
    findings.extend(f"rail-adapters missing {item}" for item in missing_strings(rail_text, required_rail_markers))

    if findings:
        return Check(
            "ops_real_data_only_guards",
            "fail",
            "; ".join(findings[:12]),
            "Reject synthetic/mock/seed/static/fallback IDs and leave unconfigured source layers empty with source-health status.",
        )
    return Check("ops_real_data_only_guards", "pass", "Synthetic markers are rejected and unconfigured sources stay real-data-only.")


def check_ops_spatial_rpc_read_model_presence() -> Check:
    sql_files = sorted((SUPABASE_ROOT / "migrations").glob("*.sql"))
    missing_files = [str(path.relative_to(ROOT)) for path in sql_files if not path.exists()]
    sql = "\n".join(read(path) for path in sql_files if path.exists())
    missing_tables = [table for table in READ_MODEL_TABLES if f"create table if not exists {table}" not in sql]
    missing_rls = [table for table in READ_MODEL_TABLES if table != "smart_city_sources" and f"alter table {table} enable row level security" not in sql]
    required_indexes = [
        "smart_city_assets_geometry_gix",
        "smart_city_events_geometry_gix",
        "smart_city_hotspots_geometry_gix",
        "smart_city_objects_geometry_gix",
        "smart_city_events_geometry_active_gix",
        "smart_city_assets_geometry_active_gix",
        "smart_city_insights_evidence_gin",
        "smart_city_action_records_evidence_gin",
        "smart_city_action_records_research_proposal_uidx",
        "smart_city_commands_object_ids_gin",
        "smart_city_action_events_record_idx",
    ]
    missing_indexes = [name for name in required_indexes if name not in sql]
    has_postgis = "create extension if not exists postgis" in sql.lower()
    rpc_functions = re.findall(r"create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_]+)", sql, flags=re.I)

    spatial = OPS_ROOT / "lib" / "spatial-read-model.ts"
    spatial_text = read(spatial) if spatial.exists() else ""
    required_read_model_functions = [
        "refreshSpatialCoreReadModel",
        "getReadModelOverview",
        "getReadModelOntology",
        "getReadModelInsights",
        "getLayerRegistry",
        "getLayerFeatures",
        "getLayerMvtTile",
        "getSourceSla",
        "decodeLayerCursor",
        "readSupabaseOverview",
        "readSupabaseOntology",
        "readSupabaseInsights",
        "rpcRows",
        "smart_city_get_layer_features",
        "smart_city_get_layer_mvt",
        "smart_city_get_layer_features_page",
        "smart_city_source_sla_v",
        "smart_city_finish_ingest_run",
    ]
    missing_functions = missing_strings(spatial_text, required_read_model_functions)
    required_sql_markers = [
        "smart_city_get_layer_mvt",
        "smart_city_get_layer_features_page",
        "smart_city_source_sla_v",
        "smart_city_transition_action_record",
        "smart_city_commands_command_type_check",
    ]
    missing_sql_markers = missing_strings(sql, required_sql_markers)

    if missing_files or missing_tables or missing_indexes or missing_functions or missing_sql_markers or not has_postgis:
        return Check(
            "ops_spatial_rpc_read_model_presence",
            "fail",
            (
                f"missing_files={missing_files}; missing_tables={missing_tables}; missing_indexes={missing_indexes}; "
                f"missing_functions={missing_functions}; missing_sql_markers={missing_sql_markers}; "
                f"missing_rls={missing_rls}; has_postgis={has_postgis}; rpc_functions={rpc_functions}"
            ),
            "Restore PostGIS smart_city_* migrations and spatial read-model APIs before relying on ops dashboard contracts.",
            metrics={"rpcFunctionCount": len(rpc_functions)},
        )

    status = "pass" if rpc_functions else "warn"
    details = (
        "PostGIS smart_city_* read model, indexes, RLS, and route-facing read-model functions are present."
        if rpc_functions
        else "PostGIS smart_city_* read model is present; no dedicated smart-city SQL RPC function is defined."
    )
    return Check(
        "ops_spatial_rpc_read_model_presence",
        status,
        details,
        "" if status == "pass" else "Add a bounded spatial RPC if/when viewport filtering moves from API read-model code into Postgres.",
        metrics={"rpcFunctionCount": len(rpc_functions), "tableCount": len(READ_MODEL_TABLES), "missingRls": missing_rls},
    )


def check_ops_agentic_audit_lifecycle_presence() -> Check:
    required_files = [
        OPS_ROOT / "lib" / "ops-auth.ts",
        OPS_ROOT / "lib" / "map-command-executor.ts",
        OPS_ROOT / "lib" / "command-audit.ts",
        OPS_ROOT / "lib" / "action-lifecycle.ts",
        OPS_API_ROOT / "commands" / "execute" / "route.ts",
        OPS_API_ROOT / "commands" / "log" / "route.ts",
        OPS_API_ROOT / "commands" / "[id]" / "route.ts",
        OPS_API_ROOT / "actions" / "[id]" / "transition" / "route.ts",
        OPS_API_ROOT / "sources" / "sla" / "route.ts",
        OPS_API_ROOT / "tiles" / "[z]" / "[x]" / "[y]" / "route.ts",
    ]
    missing_files = [str(path.relative_to(ROOT)) for path in required_files if not path.exists()]
    texts = {path: read(path) for path in required_files if path.exists()}
    required_markers = [
        (OPS_ROOT / "lib" / "ops-auth.ts", "OPS_RBAC_POLICY_JSON"),
        (OPS_ROOT / "lib" / "ops-auth.ts", '"record.action"'),
        (OPS_ROOT / "lib" / "map-command-executor.ts", "validateOpsMapCommand"),
        (OPS_ROOT / "lib" / "command-audit.ts", "smart_city_command_batches"),
        (OPS_ROOT / "lib" / "command-audit.ts", "idempotencyHash"),
        (OPS_ROOT / "lib" / "command-audit.ts", "postgresArrayContains"),
        (OPS_ROOT / "lib" / "action-lifecycle.ts", "Invalid action transition"),
        (OPS_ROOT / "lib" / "action-lifecycle.ts", "rpc/smart_city_transition_action_record"),
        (OPS_API_ROOT / "commands" / "execute" / "route.ts", "apply.ui_command"),
        (OPS_API_ROOT / "actions" / "[id]" / "transition" / "route.ts", "transition.action"),
        (OPS_API_ROOT / "tiles" / "[z]" / "[x]" / "[y]" / "route.ts", "application/vnd.mapbox-vector-tile"),
        (OPS_API_ROOT / "sources" / "sla" / "route.ts", "getSourceSla"),
    ]
    missing_markers = [
        f"{path.relative_to(ROOT)} missing {needle}"
        for path, needle in required_markers
        if needle not in texts.get(path, "")
    ]
    if missing_files or missing_markers:
        return Check(
            "ops_agentic_audit_lifecycle_presence",
            "fail",
            f"missing_files={missing_files}; missing_markers={missing_markers}",
            "Restore server-side RBAC, persisted command audit, action lifecycle, source SLA, and MVT routes.",
        )
    return Check("ops_agentic_audit_lifecycle_presence", "pass", "Agentic command audit, RBAC, action lifecycle, SLA, and MVT routes are present.")


def maybe_strict(checks: list[Check], strict: bool) -> list[Check]:
    if not strict:
        return checks
    promoted: list[Check] = []
    for check in checks:
        if check.status != "warn":
            promoted.append(check)
            continue
        promoted.append(
            Check(
                name=check.name,
                status="fail",
                details=f"{check.details} [strict mode promoted warn to fail]",
                remediation=check.remediation,
                latency_ms=check.latency_ms,
                metrics=check.metrics,
            ),
        )
    return promoted


def build_checks(strict: bool) -> list[Check]:
    checks = [
        check_docs(),
        check_env_example(),
        check_secret_exposure(),
        check_mcp_tool_annotations(),
        check_agent_bounds_and_annotations(),
        check_generated_feed_artifacts(),
        check_no_static_feed(),
        check_reports_ignored(),
        check_ops_dashboard_isolation(),
        check_ops_server_secret_boundary(),
        check_ops_ingest_auth_guard(),
        check_ops_action_record_research_guard(),
        check_ops_real_data_only_guards(),
        check_ops_spatial_rpc_read_model_presence(),
        check_ops_agentic_audit_lifecycle_presence(),
    ]
    return maybe_strict(checks, strict)


def main() -> None:
    parser = argparse.ArgumentParser(description="Check CivilMCP and ops-dashboard hardening invariants.")
    parser.add_argument("--strict", action="store_true", help="Promote warnings to failures.")
    parser.add_argument("--json-only", action="store_true", help="Print the full JSON report without writing harness/reports files.")
    args = parser.parse_args()

    checks = build_checks(args.strict)
    report = make_report("ops_invariants", checks, metrics={"strict": args.strict})

    if args.json_only:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        path = write_report("ops_invariants", report)
        print_report(report, path)

    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
