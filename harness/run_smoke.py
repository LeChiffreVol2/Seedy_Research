from __future__ import annotations

import argparse
import json
import time
from typing import Any

from common import Check, http_json, is_connection_error, load_env, make_report, print_report, write_report

DEFAULT_QUESTION = "ค้นงาน NCCE ด้านโครงสร้างที่เกี่ยวกับคอนกรีต"
EXPECTED_MCP_TOOLS = {
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
}


def question_for_collection(collection: str) -> str:
    if collection == "ce_project":
        return "จาก CE Project สรุปแนวทางลดอุบัติเหตุทางแยกพร้อมหลักฐาน"
    if collection == "ncce":
        return "จาก NCCE ค้นงานด้านโครงสร้างที่เกี่ยวกับคอนกรีตพร้อมหลักฐาน"
    return DEFAULT_QUESTION


def auth_headers(env: dict[str, str]) -> dict[str, str]:
    key = (env.get("MCP_HARNESS_API_KEY") or env.get("MCP_SERVER_API_KEY") or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def check_get_json(name: str, url: str, required_key: str | None = None) -> Check:
    try:
        status, payload, latency = http_json("GET", url, timeout=45)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(name, "warn", f"Endpoint unavailable: {url}; {exc}", "Start the service or set MCP_URL/WEB_URL to a reachable endpoint.")
        raise
    ok = 200 <= status < 300 and (required_key is None or required_key in payload)
    return Check(
        name,
        "pass" if ok else "fail",
        f"HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:1000]}",
        "" if ok else "Fix endpoint response contract.",
        latency,
    )


def check_mcp_tools_contract(mcp_url: str) -> Check:
    try:
        status, payload, latency = http_json("GET", f"{mcp_url}/tools/list", timeout=45)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("mcp_tools_list", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
        raise
    tools = payload.get("tools") if isinstance(payload, dict) else None
    names = {str(tool.get("name")) for tool in tools if isinstance(tool, dict)} if isinstance(tools, list) else set()
    missing = sorted(EXPECTED_MCP_TOOLS - names)
    annotation_issues = [
        str(tool.get("name"))
        for tool in (tools or [])
        if isinstance(tool, dict)
        and tool.get("name") in EXPECTED_MCP_TOOLS
        and (
            not isinstance(tool.get("annotations"), dict)
            or tool["annotations"].get("readOnlyHint") is not True
            or tool["annotations"].get("destructiveHint") is not False
        )
    ]
    ok = 200 <= status < 300 and not missing and not annotation_issues
    return Check(
        "mcp_tools_list",
        "pass" if ok else "fail",
        f"HTTP {status}; tools={len(names)}; missing={missing}; annotation_issues={annotation_issues}",
        "" if ok else "Expose all 11 read-only CivilMCP tools with non-destructive annotations.",
        latency,
        {"toolCount": len(names)},
    )


def check_mcp_source_boundary(mcp_url: str, env: dict[str, str]) -> Check:
    body = {
        "name": "list_source_providers",
        "arguments": {},
    }
    try:
        status, payload, latency = http_json(
            "POST",
            f"{mcp_url}/tools/call",
            body=body,
            headers=auth_headers(env),
            timeout=60,
        )
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("mcp_source_boundary", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
        raise
    structured = payload.get("structuredContent") if isinstance(payload, dict) else None
    providers = structured.get("providers") if isinstance(structured, dict) else None
    tci = next(
        (item for item in providers if isinstance(item, dict) and item.get("provider") == "tci_thaijo"),
        None,
    ) if isinstance(providers, list) else None
    ok = (
        200 <= status < 300
        and isinstance(tci, dict)
        and int(tci.get("metadata_only") or 0) > 0
        and int(tci.get("citable") or 0) == 0
    )
    return Check(
        "mcp_source_boundary",
        "pass" if ok else "fail",
        f"HTTP {status}; tci={json.dumps(tci, ensure_ascii=False)}",
        "" if ok else "Keep ThaiJO discovery records metadata-only until their evidence promotion gate passes.",
        latency,
    )


def check_web_tci_boundary(web_url: str) -> Check:
    try:
        status, payload, latency = http_json("GET", f"{web_url}/api/research-feed?filter=tci&limit=3", timeout=45)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("web_tci_boundary", "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL.")
        raise
    cards = payload.get("cards") if isinstance(payload, dict) else None
    ok = (
        200 <= status < 300
        and isinstance(cards, list)
        and bool(cards)
        and all(
            isinstance(card, dict)
            and card.get("provider") == "tci_thaijo"
            and card.get("evidenceStatus") == "metadata_only"
            and card.get("citable") is False
            and str(card.get("canonicalUrl") or "").startswith("https://")
            for card in cards
        )
    )
    return Check(
        "web_tci_boundary",
        "pass" if ok else "fail",
        f"HTTP {status}; cards={len(cards) if isinstance(cards, list) else 'missing'}",
        "" if ok else "Render ThaiJO discovery records with canonical links and never mark them citable.",
        latency,
    )


def check_web_unified_search(web_url: str) -> Check:
    try:
        status, payload, latency = http_json(
            "GET",
            f"{web_url}/api/research-feed?filter=hot&q=soil&limit=12",
            timeout=45,
        )
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("web_unified_search", "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL.")
        raise
    cards = payload.get("cards") if isinstance(payload, dict) else None
    evidence_cards = [
        card for card in (cards or [])
        if isinstance(card, dict) and card.get("citable") is True
    ]
    discovery_cards = [
        card for card in (cards or [])
        if isinstance(card, dict)
        and card.get("provider") == "tci_thaijo"
        and card.get("evidenceStatus") == "metadata_only"
        and card.get("citable") is False
    ]
    ok = 200 <= status < 300 and bool(evidence_cards) and bool(discovery_cards)
    return Check(
        "web_unified_search",
        "pass" if ok else "fail",
        f"HTTP {status}; evidence={len(evidence_cards)}; discovery={len(discovery_cards)}",
        "" if ok else "Search should combine page-citable Thai evidence with clearly labeled ThaiJO discovery metadata.",
        latency,
    )


def check_mcp_tool(mcp_url: str, env: dict[str, str], collection: str) -> Check:
    document_ids: list[str] = []
    if collection == "ncce":
        section_body = {
            "name": "search_civil_sections",
            "arguments": {
                "query": "คอนกรีตเสริมเหล็ก โครงสร้าง",
                "collection": collection,
                "max_results": 3,
            },
        }
        try:
            section_status, section_payload, _ = http_json(
                "POST",
                f"{mcp_url}/tools/call",
                body=section_body,
                headers=auth_headers(env),
                timeout=60,
            )
        except BaseException as exc:
            if is_connection_error(exc):
                return Check(f"mcp_search_chunks_{collection}", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
            raise
        structured = section_payload.get("structuredContent") if isinstance(section_payload, dict) else None
        section_results = structured.get("results") if isinstance(structured, dict) else None
        if section_status < 200 or section_status >= 300 or not isinstance(section_results, list) or not section_results:
            return Check(
                f"mcp_search_chunks_{collection}",
                "fail",
                f"Could not prefilter NCCE sections before chunk smoke; HTTP {section_status}",
                "Check search_civil_sections with collection='ncce'.",
            )
        document_ids = [str(item.get("document_id")) for item in section_results if item.get("document_id")][:3]

    body = {
        "name": "search_civil_chunks",
        "arguments": {
            "query": "คอนกรีตเสริมเหล็ก โครงสร้าง" if collection == "ncce" else "ลดอุบัติเหตุทางแยก",
            "collection": collection,
            "max_results": 3,
        },
    }
    if document_ids:
        body["arguments"]["document_ids"] = document_ids
    attempts: list[str] = []
    status = 0
    payload: Any = {}
    latency = 0.0
    for attempt in range(2):
        try:
            status, payload, latency = http_json("POST", f"{mcp_url}/tools/call", body=body, headers=auth_headers(env), timeout=60)
        except BaseException as exc:
            if is_connection_error(exc):
                return Check(f"mcp_search_chunks_{collection}", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
            raise
        attempts.append(f"attempt={attempt + 1} status={status}")
        if status != 502 or "timeout" not in json.dumps(payload, ensure_ascii=False).lower():
            break
        time.sleep(1)
    structured = payload.get("structuredContent") if isinstance(payload, dict) else None
    results = structured.get("results") if isinstance(structured, dict) else None
    ok = 200 <= status < 300 and isinstance(results, list) and len(results) > 0
    return Check(
        f"mcp_search_chunks_{collection}",
        "pass" if ok else "fail",
        f"HTTP {status}; results={len(results) if isinstance(results, list) else 'missing'}; {'; '.join(attempts)}",
        "Verify Supabase v2 data, MCP auth, and search_civil_chunks response shape.",
        latency,
        {"resultCount": len(results) if isinstance(results, list) else 0},
    )


def check_web_chat(web_url: str, collection: str) -> Check:
    body: dict[str, Any] = {
        "mode": "mcp",
        "model": "gpt-5.6-luna",
        "collection": collection,
        "debug": True,
        "contextOnly": True,
        "messages": [{"id": f"smoke-{collection or 'all'}", "role": "user", "parts": [{"type": "text", "text": question_for_collection(collection)}]}],
    }
    try:
        status, payload, latency = http_json("POST", f"{web_url}/api/chat", body=body, timeout=120)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(f"web_chat_context_{collection or 'all'}", "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL.")
        raise
    stats = payload.get("contextStats") if isinstance(payload, dict) else None
    evidence = payload.get("evidenceItems") if isinstance(payload, dict) else None
    ok = 200 <= status < 300 and isinstance(stats, dict) and isinstance(evidence, list) and len(evidence) > 0
    return Check(
        f"web_chat_context_{collection or 'all'}",
        "pass" if ok else "fail",
        f"HTTP {status}; contextStats={bool(stats)}; evidence={len(evidence) if isinstance(evidence, list) else 'missing'}",
        "" if ok else "Check /api/chat debug contextOnly response and MCP_URL/web env.",
        latency,
        {
            "toolCalls": stats.get("toolCalls") if isinstance(stats, dict) else None,
            "chunksSent": stats.get("chunksSent") if isinstance(stats, dict) else None,
            "evidenceCount": len(evidence) if isinstance(evidence, list) else 0,
        },
    )


def check_mcp_rejects_missing_auth(mcp_url: str) -> Check:
    body = {"name": "list_collections", "arguments": {}}
    try:
        status, payload, latency = http_json("POST", f"{mcp_url}/tools/call", body=body, timeout=30)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("mcp_rejects_missing_auth", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
        raise
    ok = status == 401
    return Check(
        "mcp_rejects_missing_auth",
        "pass" if ok else "fail",
        f"HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:500]}",
        "" if ok else "Require auth for /tools/call when REQUIRE_TOOL_AUTH=true.",
        latency,
    )


def check_mcp_transport_rejects_missing_auth(mcp_url: str) -> Check:
    body = {"jsonrpc": "2.0", "id": "negative-smoke", "method": "initialize", "params": {}}
    try:
        status, payload, latency = http_json("POST", f"{mcp_url}/", body=body, timeout=30)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("mcp_transport_rejects_missing_auth", "warn", f"MCP unavailable: {exc}", "Start MCP server or set MCP_URL.")
        raise
    ok = status == 401
    return Check(
        "mcp_transport_rejects_missing_auth",
        "pass" if ok else "fail",
        f"HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:500]}",
        "" if ok else "Protect mounted MCP transport with the same API-key guard as /tools/call.",
        latency,
    )


def check_web_chat_rejects_invalid_body(web_url: str) -> Check:
    try:
        status, payload, latency = http_json("POST", f"{web_url}/api/chat", body={}, timeout=30)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("web_chat_rejects_missing_messages", "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL.")
        raise
    ok = status == 422
    return Check(
        "web_chat_rejects_missing_messages",
        "pass" if ok else "fail",
        f"HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:500]}",
        "" if ok else "Validate /api/chat payload before model or MCP calls.",
        latency,
    )


def check_web_chat_rejects_oversized_body(web_url: str) -> Check:
    huge_text = "x" * 220_000
    body = {"messages": [{"id": "oversized", "role": "user", "parts": [{"type": "text", "text": huge_text}]}]}
    try:
        status, payload, latency = http_json("POST", f"{web_url}/api/chat", body=body, timeout=30)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check("web_chat_rejects_oversized_body", "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL.")
        raise
    ok = status in {413, 422}
    return Check(
        "web_chat_rejects_oversized_body",
        "pass" if ok else "fail",
        f"HTTP {status}: {json.dumps(payload, ensure_ascii=False)[:500]}",
        "" if ok else "Enforce /api/chat body and message-size caps before upstream calls.",
        latency,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CivilMCP harness smoke checks.")
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--mcp-only", action="store_true")
    parser.add_argument(
        "--strict",
        "--fail-on-warn",
        dest="fail_on_warn",
        action="store_true",
        help="Exit non-zero when the smoke report status is warn. The report still records warn checks for diagnosis.",
    )
    args = parser.parse_args()

    env = load_env()
    mcp_url = env.get("MCP_URL", "http://localhost:8000").rstrip("/")
    web_url = env.get("WEB_URL", "http://localhost:3000").rstrip("/")
    checks: list[Check] = []

    if not args.web_only:
        checks.append(check_get_json("mcp_health", f"{mcp_url}/health", "status"))
        checks.append(check_get_json("mcp_readiness", f"{mcp_url}/health/ready", "dependencies"))
        checks.append(check_mcp_tools_contract(mcp_url))
        checks.append(check_mcp_rejects_missing_auth(mcp_url))
        checks.append(check_mcp_transport_rejects_missing_auth(mcp_url))
        checks.append(check_mcp_source_boundary(mcp_url, env))
        checks.append(check_mcp_tool(mcp_url, env, "ce_project"))
        checks.append(check_mcp_tool(mcp_url, env, "ncce"))

    if not args.mcp_only:
        checks.append(check_get_json("web_research_feed_ncce", f"{web_url}/api/research-feed?filter=ncce&limit=3", "cards"))
        checks.append(check_web_tci_boundary(web_url))
        checks.append(check_web_unified_search(web_url))
        checks.append(check_web_chat_rejects_invalid_body(web_url))
        checks.append(check_web_chat_rejects_oversized_body(web_url))
        for collection in ["ce_project", "ncce", ""]:
            checks.append(check_web_chat(web_url, collection))

    metrics = {
        "mcpUrl": mcp_url,
        "webUrl": web_url,
        "webOnly": args.web_only,
        "mcpOnly": args.mcp_only,
        "failOnWarn": args.fail_on_warn,
    }
    report = make_report("smoke", checks, metrics)
    path = write_report("smoke", report)
    print_report(report, path)
    if report["status"] == "fail" or (args.fail_on_warn and report["status"] == "warn"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
