from __future__ import annotations

import argparse
import json
import time
from typing import Any

from common import Check, http_json, is_connection_error, load_env, make_report, print_report, write_report

DEFAULT_QUESTION = "จาก CE Project สรุปแนวทางลดอุบัติเหตุทางแยกแบบสั้นพร้อมหลักฐาน"
FOLLOW_UP = "ขยายข้อ E1 ต่อจาก paper นี้ และบอกว่าควรอ่านส่วนไหนต่อ"


def text_message(message_id: str, role: str, text: str, annotations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {
        "id": message_id,
        "role": role,
        "parts": [{"type": "text", "text": text}],
    }
    if annotations:
        message["annotations"] = annotations
    return message


def post_chat(web_url: str, body: dict[str, Any], timeout: int = 150) -> tuple[int, dict[str, Any], float]:
    status, payload, latency = http_json("POST", f"{web_url}/api/chat", body=body, timeout=timeout)
    return status, payload if isinstance(payload, dict) else {"payload": payload}, latency


def base_body(env: dict[str, str], messages: list[dict[str, Any]], force_compact: bool = False) -> dict[str, Any]:
    return {
        "mode": "mcp",
        "model": env.get("MODEL", "deepseek-v4-flash"),
        "collection": "ce_project",
        "debug": True,
        "contextOnly": True,
        "forceCompact": force_compact,
        "routerProvider": env.get("ROUTER_PROVIDER", "deepseek"),
        "routerModel": env.get("ROUTER_MODEL", "deepseek-v4-flash"),
        "messages": messages,
    }


def budget_failures(stats: dict[str, Any], env: dict[str, str]) -> list[str]:
    max_tool_calls = int(env.get("MAX_TOOL_CALLS", "4") or 4)
    max_chunks = int(env.get("MAX_CONTEXT_CHUNKS", "8") or 8)
    max_context_tokens = int(env.get("MAX_CONTEXT_TOKENS", "8000") or 8000)
    failures: list[str] = []
    if int(stats.get("toolCalls") or 0) > max_tool_calls:
        failures.append(f"toolCalls {stats.get('toolCalls')} > {max_tool_calls}")
    if int(stats.get("chunksSent") or 0) > max_chunks:
        failures.append(f"chunksSent {stats.get('chunksSent')} > {max_chunks}")
    if int(stats.get("estimatedTokens") or 0) > max_context_tokens:
        failures.append(f"estimatedTokens {stats.get('estimatedTokens')} > {max_context_tokens}")
    return failures


def synthetic_long_transcript(evidence_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    context_annotation = {
        "type": "civilmcp_context",
        "mode": "agentic_context",
        "collection": "ce_project",
        "intent": "simple_lookup",
        "toolCalls": 2,
        "evidenceItems": evidence_items,
    }
    messages: list[dict[str, Any]] = [
        text_message("memory-u-1", "user", DEFAULT_QUESTION),
        text_message(
            "memory-a-1",
            "assistant",
            "สรุปคำตอบเบื้องต้นอ้างอิง [E1] และ evidence อื่นในคำตอบก่อนหน้า",
            [context_annotation],
        ),
    ]
    for index in range(1, 6):
        messages.append(
            text_message(
                f"memory-u-fill-{index}",
                "user",
                f"ช่วยจดประเด็นต่อเนื่องรอบที่ {index}: ยังสนใจ paper เดิมและข้อจำกัดของหลักฐาน",
            ),
        )
        messages.append(
            text_message(
                f"memory-a-fill-{index}",
                "assistant",
                f"บันทึกประเด็นรอบที่ {index}: จะคง reference ไปยัง evidence เดิมและไม่ขยายออกนอก paper ถ้าไม่จำเป็น",
            ),
        )
    messages.append(text_message("memory-u-compact", "user", "ช่วยจำบริบทนี้ไว้สำหรับคำถามต่อไป"))
    return messages


def run_memory_eval(web_url: str, env: dict[str, str]) -> list[Check]:
    checks: list[Check] = []

    started = time.perf_counter()
    initial_messages = [text_message("memory-initial-u", "user", DEFAULT_QUESTION)]
    status, initial_payload, initial_latency = post_chat(web_url, base_body(env, initial_messages))
    evidence_items = initial_payload.get("evidenceItems") if isinstance(initial_payload, dict) else None
    initial_stats = initial_payload.get("contextStats") if isinstance(initial_payload, dict) else None
    if not (200 <= status < 300) or not isinstance(evidence_items, list) or not evidence_items:
        return [
            Check(
                "memory_initial_evidence",
                "fail",
                f"HTTP {status}; evidence={len(evidence_items) if isinstance(evidence_items, list) else 'missing'}",
                "Fix /api/chat debug contextOnly evidence output before memory evaluation.",
                initial_latency,
            )
        ]
    original_source = str(evidence_items[0].get("source") or "")
    checks.append(
        Check(
            "memory_initial_evidence",
            "pass",
            f"Captured {len(evidence_items)} evidence items; firstSource={original_source}",
            latency_ms=initial_latency,
            metrics={
                "evidenceCount": len(evidence_items),
                "firstSource": original_source,
                "toolCalls": initial_stats.get("toolCalls") if isinstance(initial_stats, dict) else None,
            },
        )
    )

    compact_messages = synthetic_long_transcript(evidence_items)
    status, compact_payload, compact_latency = post_chat(web_url, base_body(env, compact_messages, force_compact=True))
    memory = compact_payload.get("memory") if isinstance(compact_payload, dict) else None
    compact_stats = compact_payload.get("contextStats") if isinstance(compact_payload, dict) else {}
    active_map = memory.get("activeEvidenceMap") if isinstance(memory, dict) else None
    compact_failures: list[str] = []
    if not (200 <= status < 300):
        compact_failures.append(f"HTTP {status}")
    if not isinstance(memory, dict) or memory.get("state") != "compacted":
        compact_failures.append("memory.state is not compacted")
    if not isinstance(memory, dict) or not str(memory.get("runningSummary") or "").strip():
        compact_failures.append("runningSummary is empty")
    if not isinstance(active_map, list) or not any(item.get("source") == original_source for item in active_map if isinstance(item, dict)):
        compact_failures.append("activeEvidenceMap does not retain original source")
    compact_failures.extend(budget_failures(compact_stats if isinstance(compact_stats, dict) else {}, env))
    checks.append(
        Check(
            "memory_compaction_created",
            "fail" if compact_failures else "pass",
            json.dumps(
                {
                    "failures": compact_failures,
                    "state": memory.get("state") if isinstance(memory, dict) else None,
                    "activeEvidenceCount": len(active_map) if isinstance(active_map, list) else 0,
                    "originalSource": original_source,
                },
                ensure_ascii=False,
            ),
            "Inspect prepareConversationMemory, civilmcp_memory annotation shape, and activeEvidenceMap retention."
            if compact_failures
            else "",
            compact_latency,
            {
                "activeEvidenceCount": len(active_map) if isinstance(active_map, list) else 0,
                "toolCalls": compact_stats.get("toolCalls") if isinstance(compact_stats, dict) else None,
                "chunksSent": compact_stats.get("chunksSent") if isinstance(compact_stats, dict) else None,
            },
        )
    )

    memory_annotation = memory if isinstance(memory, dict) else {}
    followup_messages = [
        text_message("memory-a-snapshot", "assistant", "Memory checkpoint for the next follow-up.", [memory_annotation]),
        text_message("memory-u-followup", "user", FOLLOW_UP),
    ]
    status, followup_payload, followup_latency = post_chat(web_url, base_body(env, followup_messages))
    followup_stats = followup_payload.get("contextStats") if isinstance(followup_payload, dict) else {}
    anchor = followup_stats.get("conversationAnchor") if isinstance(followup_stats, dict) else None
    anchor_source = anchor.get("source") if isinstance(anchor, dict) else None
    followup_failures: list[str] = []
    if not (200 <= status < 300):
        followup_failures.append(f"HTTP {status}")
    if anchor_source != original_source:
        followup_failures.append(f"anchor source {anchor_source!r} != original source {original_source!r}")
    followup_failures.extend(budget_failures(followup_stats if isinstance(followup_stats, dict) else {}, env))
    checks.append(
        Check(
            "memory_followup_anchor",
            "fail" if followup_failures else "pass",
            json.dumps(
                {
                    "failures": followup_failures,
                    "anchorSource": anchor_source,
                    "originalSource": original_source,
                    "anchor": anchor,
                },
                ensure_ascii=False,
            ),
            "Inspect resolveConversationAnchor memory fallback and activeEvidenceMap E-number retention."
            if followup_failures
            else "",
            followup_latency,
            {
                "toolCalls": followup_stats.get("toolCalls") if isinstance(followup_stats, dict) else None,
                "chunksSent": followup_stats.get("chunksSent") if isinstance(followup_stats, dict) else None,
                "estimatedTokens": followup_stats.get("estimatedTokens") if isinstance(followup_stats, dict) else None,
            },
        )
    )

    elapsed = (time.perf_counter() - started) * 1000
    checks.append(Check("memory_eval_runtime", "pass", "Completed multi-turn memory eval.", latency_ms=elapsed))
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CivilMCP multi-turn memory continuity eval.")
    parser.add_argument("--web-url", default="")
    args = parser.parse_args()

    env = load_env()
    web_url = (args.web_url or env.get("WEB_URL", "http://localhost:3000")).rstrip("/")
    try:
        checks = run_memory_eval(web_url, env)
    except BaseException as exc:
        if is_connection_error(exc):
            checks = [
                Check(
                    "memory_web_reachable",
                    "warn",
                    f"Web unavailable: {exc}",
                    "Start web app or set WEB_URL to a reachable endpoint.",
                )
            ]
        else:
            raise

    report = make_report("memory_eval", checks, {"webUrl": web_url})
    path = write_report("memory_eval", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
