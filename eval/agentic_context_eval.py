"""
Agentic context evaluation:
Call the web /api/chat endpoint in debug mode so the route returns answer,
router intent, tool-call count, context chunk count, and model usage.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

EVAL_DIR = Path(__file__).resolve().parent
ROOT_DIR = EVAL_DIR.parent


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(EVAL_DIR / ".env")
    load_dotenv()

    web_url = os.getenv("WEB_URL", "http://localhost:3000").rstrip("/")
    model = os.getenv("MODEL", "deepseek-v4-flash")
    router_provider = os.getenv("ROUTER_PROVIDER", "deepseek")
    router_model = os.getenv("ROUTER_MODEL", "deepseek-v4-flash")
    questions = json.loads((EVAL_DIR / "questions.json").read_text(encoding="utf-8"))

    results: list[dict] = []
    for q in questions:
        body = {
            "mode": "mcp",
            "model": model,
            "debug": True,
            "routerProvider": router_provider,
            "routerModel": router_model,
            "messages": [
                {
                    "id": f"eval-{q['id']}",
                    "role": "user",
                    "parts": [{"type": "text", "text": q["question"]}],
                }
            ],
        }
        t0 = time.time()
        response = requests.post(f"{web_url}/api/chat", json=body, timeout=120)
        response.raise_for_status()
        payload = response.json()
        latency = round(time.time() - t0, 2)
        answer = payload.get("answer", "")
        usage = payload.get("usage") or {}
        total_tokens = usage.get("totalTokens") or usage.get("total_tokens") or estimate_tokens(answer)
        context_stats = payload.get("contextStats") or {}

        results.append(
            {
                "id": q["id"],
                "type": q.get("type", "unknown"),
                "discipline": q["discipline"],
                "question": q["question"],
                "answer": answer,
                "tokens": total_tokens,
                "latency": latency,
                "method": "agentic_context",
                "intent": context_stats.get("intent"),
                "router_provider": context_stats.get("routerProvider"),
                "router_model": context_stats.get("routerModel"),
                "tool_calls": context_stats.get("toolCalls"),
                "chunks_sent": context_stats.get("chunksSent"),
                "sections_sent": context_stats.get("sectionsSent"),
                "estimated_context_tokens": context_stats.get("estimatedTokens"),
                "citations_present": bool(re.search(r"\[[^\]]+\.md[^\]]*\]", answer)),
            }
        )
        print(
            f"[{q['id']}] intent={context_stats.get('intent')} "
            f"router={context_stats.get('routerProvider')}/{context_stats.get('routerModel')} "
            f"tools={context_stats.get('toolCalls')} chunks={context_stats.get('chunksSent')} "
            f"tokens={total_tokens} latency={latency}s"
        )

    output = EVAL_DIR / "agentic_results.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
