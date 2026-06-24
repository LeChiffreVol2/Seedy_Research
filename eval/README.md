# Evaluation

เปรียบเทียบผลลัพธ์ `baseline` vs `mcp_rag` vs `agentic_context`.
Harness smoke uses `harness_questions.json` for 15 fixed CE/NCCE/cross-collection questions.

## Run

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
cp .env.example .env  # ทำครั้งเดียวทั้งโปรเจกต์

cd eval
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3.10 baseline.py
MCP_URL=http://localhost:8000 python3.10 mcp_eval.py
WEB_URL=http://localhost:3000 python3.10 agentic_context_eval.py
# optional router A/B
ROUTER_PROVIDER=openai ROUTER_MODEL=gpt-5-nano WEB_URL=http://localhost:3000 python3.10 agentic_context_eval.py
python3.10 compare.py
```

Harness eval:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
WEB_URL=http://localhost:3000 python3.10 harness/run_eval.py --mode smoke
# Lower-cost retrieval-only validation:
WEB_URL=http://localhost:3000 python3.10 harness/run_eval.py --mode smoke --context-only
```

If MCP auth is enabled (`REQUIRE_TOOL_AUTH=true`), set `MCP_SERVER_API_KEY` in root `.env`.

## Output files

- `baseline_results.json`
- `mcp_results.json`
- `agentic_results.json`
- `../harness/reports/latest_eval_smoke.json`
