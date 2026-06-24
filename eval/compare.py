"""
Print side-by-side report from baseline, simple MCP RAG, and optional agentic context results.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

EVAL_DIR = Path(__file__).resolve().parent


def load_results(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    return {row["id"]: row for row in json.loads(path.read_text(encoding="utf-8"))}


def main() -> None:
    baseline = load_results(EVAL_DIR / "baseline_results.json")
    simple_rag = load_results(EVAL_DIR / "mcp_results.json")
    agentic = load_results(EVAL_DIR / "agentic_results.json")

    if not baseline and not simple_rag and not agentic:
        raise RuntimeError("Missing results. Run at least one eval script first.")

    ids = sorted(set(baseline) | set(simple_rag) | set(agentic))
    print("\n" + "-" * 96)
    print(f"{'ID':<5}{'Method':<18}{'Tokens':>10}{'Latency':>12}{'Tools':>8}{'Chunks':>8}{'Cites':>8}")
    print("-" * 96)

    totals: dict[str, dict[str, float]] = {}
    labels = [
        ("baseline", baseline),
        ("simple_rag", simple_rag),
        ("agentic_context", agentic),
    ]

    for qid in ids:
        first = next((rows[qid] for _, rows in labels if qid in rows), {})
        print(f"Q: {qid} · {first.get('question', '')}")
        for label, rows in labels:
            row = rows.get(qid)
            if not row:
                continue
            totals.setdefault(label, {"tokens": 0.0, "latency": 0.0, "count": 0.0})
            totals[label]["tokens"] += float(row.get("tokens") or 0)
            totals[label]["latency"] += float(row.get("latency") or 0)
            totals[label]["count"] += 1
            print(
                f"{qid:<5}{label:<18}{int(row.get('tokens') or 0):>10,}"
                f"{float(row.get('latency') or 0):>11.1f}s"
                f"{str(row.get('tool_calls', '-')):>8}"
                f"{str(row.get('chunks_sent', '-')):>8}"
                f"{str(row.get('citations_present', '-')):>8}"
            )
            print(f"A: {str(row.get('answer', ''))[:180]}...")
        print()

    print("Summary")
    for label, stat in totals.items():
        count = max(stat["count"], 1)
        print(
            f"- {label:<16} tokens={int(stat['tokens']):,} "
            f"avg_latency={stat['latency'] / count:.2f}s"
        )


if __name__ == "__main__":
    main()
