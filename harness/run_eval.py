from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

from common import ROOT, Check, http_json, is_connection_error, load_env, make_report, print_report, write_report

QUESTION_FILE = ROOT / "eval" / "harness_questions.json"
CITATION_PATTERN = re.compile(r"\[(?:E\d+|[^\]]+\.md[^\]]*)\]")
EVIDENCE_ID_PATTERN = re.compile(r"\[(E\d+)\]")


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (len(ordered) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 2)


def cited_evidence_ids(answer: str) -> list[str]:
    return sorted(set(EVIDENCE_ID_PATTERN.findall(answer)))


def evidence_ids(evidence: Any) -> set[str]:
    if not isinstance(evidence, list):
        return set()
    return {str(item.get("evidenceId")) for item in evidence if isinstance(item, dict) and item.get("evidenceId")}


def evidence_has_required_metadata(evidence: Any, cited_ids: list[str]) -> tuple[bool, list[str]]:
    if not isinstance(evidence, list):
        return False, cited_ids
    by_id = {str(item.get("evidenceId")): item for item in evidence if isinstance(item, dict)}
    invalid: list[str] = []
    for citation_id in cited_ids:
        item = by_id.get(citation_id)
        if not item or not item.get("source"):
            invalid.append(citation_id)
            continue
        collection = item.get("collection")
        if collection == "ncce" and item.get("pageStart") is None and item.get("page_start") is None:
            invalid.append(citation_id)
    return not invalid, invalid


def load_questions(mode: str) -> list[dict[str, Any]]:
    questions = json.loads(QUESTION_FILE.read_text(encoding="utf-8"))
    if mode == "smoke":
        return questions
    return questions


def expected_collection(value: str | None) -> str:
    return value or ""


def evaluate_question(web_url: str, env: dict[str, str], question: dict[str, Any], context_only: bool) -> Check:
    collection = question.get("collection", "")
    body = {
        "mode": "mcp",
        "model": env.get("MODEL", "gpt-5.6-luna"),
        "collection": collection,
        "debug": True,
        "contextOnly": context_only,
        "routerProvider": env.get("ROUTER_PROVIDER", "openai"),
        "routerModel": env.get("ROUTER_MODEL", "gpt-5.6-luna"),
        "messages": [{"id": f"harness-{question['id']}", "role": "user", "parts": [{"type": "text", "text": question["question"]}]}],
    }
    started = time.perf_counter()
    try:
        status, payload, latency = http_json("POST", f"{web_url}/api/chat", body=body, timeout=150)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(question["id"], "warn", f"Web unavailable: {exc}", "Start web app or set WEB_URL to a reachable endpoint.")
        raise
    elapsed = (time.perf_counter() - started) * 1000
    if not (200 <= status < 300) or not isinstance(payload, dict):
        return Check(question["id"], "fail", f"HTTP {status}: {str(payload)[:1000]}", "Fix /api/chat debug response.", elapsed)

    stats = payload.get("contextStats") or {}
    evidence = payload.get("evidenceItems") or []
    answer = payload.get("answer") or ""
    usage = payload.get("usage") or {}
    max_tool_calls = int(env.get("MAX_TOOL_CALLS", "4") or 4)
    max_chunks = int(env.get("MAX_CONTEXT_CHUNKS", "8") or 8)
    max_context_tokens = int(env.get("MAX_CONTEXT_TOKENS", "8000") or 8000)
    failures: list[str] = []
    warnings: list[str] = []

    if stats.get("toolCalls", 0) > max_tool_calls:
        failures.append(f"toolCalls {stats.get('toolCalls')} > {max_tool_calls}")
    if stats.get("chunksSent", 0) > max_chunks:
        failures.append(f"chunksSent {stats.get('chunksSent')} > {max_chunks}")
    if stats.get("estimatedTokens", 0) > max_context_tokens:
        failures.append(f"estimatedTokens {stats.get('estimatedTokens')} > {max_context_tokens}")
    if question.get("requiresEvidence", True) and not evidence:
        failures.append("missing evidenceItems")
    if not context_only and question.get("requiresCitation", True) and not CITATION_PATTERN.search(answer):
        failures.append("missing citation marker in answer")
    cited_ids = [] if context_only else cited_evidence_ids(answer)
    available_ids = evidence_ids(evidence)
    invalid_citation_ids = sorted(set(cited_ids) - available_ids)
    metadata_ok, metadata_invalid_ids = evidence_has_required_metadata(evidence, cited_ids)
    if not context_only and question.get("requiresCitation", True):
        if invalid_citation_ids:
            failures.append(f"citation ids not in evidenceItems: {invalid_citation_ids}")
        if not metadata_ok:
            failures.append(f"cited evidence missing source/page metadata: {metadata_invalid_ids}")

    expected_intent = question.get("expectedIntent")
    actual_intent = stats.get("intent")
    intent_match = bool(expected_intent and actual_intent == expected_intent)
    if expected_intent and actual_intent and actual_intent != expected_intent:
        warnings.append(f"intent {actual_intent} != {expected_intent}")

    expected_coll = expected_collection(collection)
    actual_coll = stats.get("collection") or ""
    collection_match = actual_coll == expected_coll
    if actual_coll != expected_coll:
        warnings.append(f"collection {actual_coll or 'all'} != {expected_coll or 'all'}")

    citations_present = bool(CITATION_PATTERN.search(answer))
    citation_correct = bool(cited_ids) and not invalid_citation_ids and metadata_ok
    citation_id_accuracy = (
        (len(cited_ids) - len(invalid_citation_ids)) / len(cited_ids)
        if cited_ids
        else 0.0
    )
    metrics = {
        "intent": actual_intent,
        "expectedIntent": expected_intent,
        "intentMatch": intent_match,
        "collection": actual_coll,
        "expectedCollection": expected_coll,
        "collectionMatch": collection_match,
        "routerSource": stats.get("routerSource"),
        "routerLatencyMs": stats.get("routerLatencyMs"),
        "contextLatencyMs": stats.get("contextLatencyMs"),
        "toolCalls": stats.get("toolCalls"),
        "chunksSent": stats.get("chunksSent"),
        "sectionsSent": stats.get("sectionsSent"),
        "estimatedContextTokens": stats.get("estimatedTokens"),
        "evidenceCount": len(evidence) if isinstance(evidence, list) else 0,
        "answerTokensEstimate": estimate_tokens(answer),
        "totalTokens": usage.get("totalTokens") or usage.get("total_tokens"),
        "citationsPresent": citations_present,
        "citationMarkers": cited_ids,
        "invalidCitationIds": invalid_citation_ids,
        "citationCorrect": citation_correct,
        "citationIdAccuracy": round(citation_id_accuracy, 4),
    }
    details = {
        "question": question["question"],
        "type": question.get("type"),
        "collection": collection or "all",
        "failures": failures,
        "warnings": warnings,
    }
    check_status = "fail" if failures else "warn" if warnings else "pass"
    return Check(
        question["id"],
        check_status,
        json.dumps(details, ensure_ascii=False),
        "Inspect /api/chat retrieval recipe, evidence builder, or answer prompt for this query." if failures else "",
        latency,
        metrics,
    )


def avg_metric(checks: list[Check], key: str) -> float | None:
    values = [float(check.metrics[key]) for check in checks if isinstance(check.metrics.get(key), (int, float))]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def slo_metrics(checks: list[Check], env: dict[str, str]) -> dict[str, Any]:
    latencies = [float(check.latency_ms or 0) for check in checks if check.latency_ms is not None]
    context_latencies = [
        float(check.metrics["contextLatencyMs"])
        for check in checks
        if isinstance(check.metrics.get("contextLatencyMs"), (int, float))
    ]
    p95_limit = float(env.get("HARNESS_EVAL_P95_LATENCY_MS", "25000") or 25000)
    max_limit = float(env.get("HARNESS_EVAL_MAX_LATENCY_MS", "30000") or 30000)
    context_p95_limit = float(env.get("HARNESS_EVAL_CONTEXT_P95_MS", "8000") or 8000)
    enforced = env.get("HARNESS_ENFORCE_SLO", "false").lower() == "true"
    p95 = percentile(latencies, 0.95)
    context_p95 = percentile(context_latencies, 0.95)
    max_latency = round(max(latencies), 2) if latencies else None
    violations: list[str] = []
    if p95 is not None and p95 > p95_limit:
        violations.append(f"p95 latency {p95}ms > {p95_limit}ms")
    if max_latency is not None and max_latency > max_limit:
        violations.append(f"max latency {max_latency}ms > {max_limit}ms")
    if context_p95 is not None and context_p95 > context_p95_limit:
        violations.append(f"context p95 latency {context_p95}ms > {context_p95_limit}ms")
    return {
        "latency": {
            "p50Ms": percentile(latencies, 0.5),
            "p95Ms": p95,
            "maxMs": max_latency,
            "contextP95Ms": context_p95,
        },
        "slo": {
            "latencyP95Ms": p95_limit,
            "maxLatencyMs": max_limit,
            "contextLatencyP95Ms": context_p95_limit,
            "latencySloMet": not violations,
            "enforced": enforced,
            "violations": violations,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CivilMCP harness eval suite.")
    parser.add_argument("--mode", choices=["smoke"], default="smoke")
    parser.add_argument("--context-only", action="store_true", help="Skip answer generation and validate retrieval context only.")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    env = load_env()
    web_url = env.get("WEB_URL", "http://localhost:3000").rstrip("/")
    questions = load_questions(args.mode)
    if args.limit > 0:
        questions = questions[: args.limit]

    checks = [evaluate_question(web_url, env, question, args.context_only) for question in questions]
    citation_required = [] if args.context_only else checks
    citation_coverage = None if args.context_only else sum(1 for check in checks if check.metrics.get("citationsPresent")) / max(1, len(checks))
    citation_correctness = None if args.context_only else sum(1 for check in checks if check.metrics.get("citationCorrect")) / max(1, len(checks))
    intent_accuracy = sum(1 for check in checks if check.metrics.get("intentMatch")) / max(1, len(checks))
    collection_accuracy = sum(1 for check in checks if check.metrics.get("collectionMatch")) / max(1, len(checks))
    slo = slo_metrics(checks, env)
    metrics = {
        "webUrl": web_url,
        "mode": args.mode,
        "contextOnly": args.context_only,
        "questionCount": len(questions),
        "citationCoverage": None if citation_coverage is None else round(citation_coverage, 4),
        "citationCorrectness": None if citation_correctness is None else round(citation_correctness, 4),
        "intentAccuracy": round(intent_accuracy, 4),
        "collectionAccuracy": round(collection_accuracy, 4),
        "avgLatencyMs": round(sum(check.latency_ms or 0 for check in checks) / max(1, len(checks)), 2),
        "avgRouterLatencyMs": avg_metric(checks, "routerLatencyMs"),
        "avgContextLatencyMs": avg_metric(checks, "contextLatencyMs"),
        "avgToolCalls": round(sum(float(check.metrics.get("toolCalls") or 0) for check in checks) / max(1, len(checks)), 2),
        "avgChunksSent": round(sum(float(check.metrics.get("chunksSent") or 0) for check in checks) / max(1, len(checks)), 2),
        "citationRequiredChecks": len(citation_required),
        **slo,
    }
    report = make_report(f"eval_{args.mode}", checks, metrics)
    if slo["slo"]["enforced"] and slo["slo"]["violations"] and report["status"] != "fail":
        report["status"] = "fail"
    path = write_report(f"eval_{args.mode}", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
