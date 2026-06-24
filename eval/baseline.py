"""
Baseline evaluation:
Send markdown context directly to model without retrieval tool-calling.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

EVAL_DIR = Path(__file__).resolve().parent
ROOT_DIR = EVAL_DIR.parent

DISC_PREFIX = {
    "transport": "TR",
    "structural": "ST",
    "geotechnical": "GE",
    "construction_mgmt": "CM",
}


def load_context(md_dir: Path, discipline: str, max_chars: int = 60_000) -> str:
    prefix = DISC_PREFIX.get(discipline, "")
    files = sorted(md_dir.glob(f"*_{prefix}_*.md")) if prefix else sorted(md_dir.glob("*.md"))
    if not files:
        return ""

    chunks: list[str] = []
    for file in files:
        chunks.append(f"# {file.name}\n" + file.read_text(encoding="utf-8")[:4000])
        if sum(len(c) for c in chunks) >= max_chars:
            break
    return "\n\n---\n\n".join(chunks)[:max_chars]


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(EVAL_DIR / ".env")
    load_dotenv()

    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("MODEL", "gpt-5-mini-2025-08-07")
    md_dir = Path(os.getenv("MD_DIR", str(ROOT_DIR / "pipeline" / "data" / "markdown")))
    questions = json.loads((EVAL_DIR / "questions.json").read_text(encoding="utf-8"))

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    if not md_dir.exists():
        raise RuntimeError(f"Markdown directory not found: {md_dir}")

    client = OpenAI(api_key=api_key)
    results: list[dict] = []

    for q in questions:
        context = load_context(md_dir, q["discipline"])
        t0 = time.time()
        response = client.chat.completions.create(
            model=model,
            max_tokens=700,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Civil Engineering assistant. "
                        "Answer only from the provided documents. "
                        "If not found, answer exactly: ไม่พบข้อมูลในเอกสาร"
                    ),
                },
                {
                    "role": "user",
                    "content": f"Documents:\n{context}\n\nQuestion: {q['question']}",
                },
            ],
        )
        latency = round(time.time() - t0, 2)
        usage = response.usage.total_tokens if response.usage else 0
        answer = response.choices[0].message.content or ""
        results.append(
            {
                "id": q["id"],
                "discipline": q["discipline"],
                "question": q["question"],
                "answer": answer,
                "tokens": usage,
                "latency": latency,
                "method": "baseline",
            }
        )
        print(f"[{q['id']}] tokens={usage} latency={latency}s")

    output = EVAL_DIR / "baseline_results.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
