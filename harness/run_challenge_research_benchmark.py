from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import ROOT


BENCHMARK = ROOT / "harness" / "challenge_research_benchmark.json"
DEFAULT_OUTPUT = ROOT / "harness" / "reports" / "challenge-research-benchmark.json"


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))]


def get_json(url: str, timeout: float) -> tuple[dict[str, Any], float]:
    started = time.perf_counter()
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "SeedyChallengeBenchmark/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload, (time.perf_counter() - started) * 1000


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the release-bound Seedy Challenge Research Benchmark.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    definition = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    verified_not_found = set(definition.get("verifiedNotFoundSources", []))
    results: list[dict[str, Any]] = []
    for case in definition["cases"]:
        query = urllib.parse.urlencode({"filter": "thai", "collection": "all", "limit": "3", "q": case["question"]})
        url = f"{args.base_url.rstrip('/')}/api/research-feed?{query}"
        try:
            payload, latency_ms = get_json(url, args.timeout)
            cards = payload.get("cards", [])[:3]
            sources = [str(card.get("source", "")) for card in cards]
            expected = set(case["expectedSources"])
            relevance_pass = bool(expected.intersection(sources)) if case["kind"] == "answerable" else len(cards) == 0
            evidence_pass = case["kind"] != "answerable" or any(
                card.get("source") in expected
                and card.get("citable") is True
                and card.get("thaiPublished") is not False
                for card in cards
            )
            unverified_not_found = [
                card.get("source") for card in cards
                if (card.get("visibility") or {}).get("state") == "not_found_in_audit"
                and card.get("source") not in verified_not_found
            ]
            results.append({
                "id": case["id"], "discipline": case["discipline"], "kind": case["kind"],
                "question": case["question"], "expectedSources": case["expectedSources"], "top3Sources": sources,
                "relevancePass": relevance_pass, "evidencePass": evidence_pass,
                "unverifiedNotFoundSources": unverified_not_found, "latencyMs": round(latency_ms, 1), "error": None,
            })
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            results.append({
                "id": case["id"], "discipline": case["discipline"], "kind": case["kind"],
                "question": case["question"], "expectedSources": case["expectedSources"], "top3Sources": [],
                "relevancePass": False, "evidencePass": False, "unverifiedNotFoundSources": [],
                "latencyMs": None, "error": str(error),
            })

    answerable = [row for row in results if row["kind"] == "answerable"]
    sparse = [row for row in results if row["kind"] == "sparse"]
    latencies = [float(row["latencyMs"]) for row in results if row["latencyMs"] is not None]
    summary = {
        "top3RelevanceRate": sum(bool(row["relevancePass"]) for row in results) / len(results),
        "answerableEvidenceRate": sum(bool(row["evidencePass"]) for row in answerable) / len(answerable),
        "negativeControlSparseRate": sum(bool(row["relevancePass"]) for row in sparse) / len(sparse),
        "unverifiedNotFoundClaims": sum(len(row["unverifiedNotFoundSources"]) for row in results),
        "p95DiscoveryLatencyMs": round(percentile(latencies, 0.95), 1),
        "errorCount": sum(row["error"] is not None for row in results),
    }
    gates = {
        "top3Relevance": summary["top3RelevanceRate"] >= 0.90,
        "answerableEvidence": summary["answerableEvidenceRate"] >= 0.80,
        "negativeControls": summary["negativeControlSparseRate"] == 1.0,
        "visibilitySafety": summary["unverifiedNotFoundClaims"] == 0,
        "discoveryLatency": summary["p95DiscoveryLatencyMs"] <= 5000,
        "requestsSucceeded": summary["errorCount"] == 0,
    }
    report = {
        "benchmarkVersion": definition["version"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": args.base_url,
        "definition": definition["definition"],
        "summary": summary,
        "gates": gates,
        "passed": all(gates.values()),
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "summary": summary, "gates": gates}, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
