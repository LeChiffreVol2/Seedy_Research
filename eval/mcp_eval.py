"""
MCP RAG evaluation:
Model tool-calling loop -> MCP /tools/call endpoint -> Supabase retrieval.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from openai import OpenAI

EVAL_DIR = Path(__file__).resolve().parent
ROOT_DIR = EVAL_DIR.parent


def call_mcp(mcp_url: str, name: str, args: dict, api_key: str | None = None) -> str:
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = requests.post(
        f"{mcp_url.rstrip('/')}/tools/call",
        json={"name": name, "arguments": args},
        headers=headers,
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    text = data.get("content", [{}])[0].get("text")
    if text:
        return text
    structured = data.get("structuredContent")
    return json.dumps(structured, ensure_ascii=False) if structured is not None else "No result"


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(EVAL_DIR / ".env")
    load_dotenv()

    model = os.getenv("MODEL", "deepseek-v4-flash")
    is_deepseek = model.startswith("deepseek-")
    api_key = os.getenv("DEEPSEEK_API_KEY" if is_deepseek else "OPENAI_API_KEY")
    mcp_url = os.getenv("MCP_URL", "http://localhost:8000")
    mcp_server_api_key = os.getenv("MCP_SERVER_API_KEY")
    questions = json.loads((EVAL_DIR / "questions.json").read_text(encoding="utf-8"))

    if not api_key:
        raise RuntimeError(f"{'DEEPSEEK_API_KEY' if is_deepseek else 'OPENAI_API_KEY'} is not set.")

    client = OpenAI(
        api_key=api_key,
        **({"base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")} if is_deepseek else {}),
    )

    tools = [
        {
            "type": "function",
            "function": {
                "name": "search_civil_knowledge",
                "description": (
                    "Search Civil Engineering RAG knowledge base. "
                    "Must call before answering engineering questions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "discipline": {
                            "type": "string",
                            "enum": [
                                "transport",
                                "structural",
                                "geotechnical",
                                "construction_mgmt",
                                "",
                            ],
                        },
                        "max_results": {"type": "integer", "default": 5},
                    },
                    "required": ["query"],
                },
            },
        }
    ]

    results: list[dict] = []

    for q in questions:
        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "You are a Civil Engineering assistant. "
                    "Always call search_civil_knowledge first. "
                    "Answer in Thai and cite source file names."
                ),
            },
            {"role": "user", "content": q["question"]},
        ]
        total_tokens = 0
        t0 = time.time()

        while True:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                max_tokens=700,
            )
            total_tokens += response.usage.total_tokens if response.usage else 0
            msg = response.choices[0].message

            if msg.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": msg.content or "",
                        "tool_calls": [
                            {
                                "id": tool_call.id,
                                "type": "function",
                                "function": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments,
                                },
                            }
                            for tool_call in msg.tool_calls
                        ],
                    }
                )
                for tool_call in msg.tool_calls:
                    args = json.loads(tool_call.function.arguments or "{}")
                    args.setdefault("discipline", q["discipline"])
                    tool_result = call_mcp(
                        mcp_url,
                        tool_call.function.name,
                        args,
                        api_key=mcp_server_api_key,
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result,
                        }
                    )
                continue

            answer = msg.content or ""
            break

        latency = round(time.time() - t0, 2)
        results.append(
            {
                "id": q["id"],
                "discipline": q["discipline"],
                "question": q["question"],
                "answer": answer,
                "tokens": total_tokens,
                "latency": latency,
                "method": "mcp_rag",
            }
        )
        print(f"[{q['id']}] tokens={total_tokens} latency={latency}s")

    output = EVAL_DIR / "mcp_results.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
