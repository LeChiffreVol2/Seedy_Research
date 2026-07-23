# CivilMCP Agent Map

This repository is an agent-legible system of record for CivilMCP. Start here, then open only the linked docs needed for the task.

## Product
CivilMCP is a Research Preview for an Agentic Context Engine over civil engineering papers. The user-facing product is a Next.js chat/feed app backed by a Python FastAPI MCP-style retrieval server and Supabase pgvector.

## Source Of Truth
- Architecture: `docs/ARCHITECTURE.md`
- Harness and QA commands: `docs/HARNESS.md`
- Product quality gates: `docs/QUALITY_SCORE.md`
- Launch decision and rollout bar: `docs/LAUNCH_READINESS.md`
- Data-provider expansion and promotion gates: `docs/DATA_EXPANSION.md`
- Operations and rollback: `docs/OPERATIONS.md`
- GitHub push checklist: `docs/GITHUB_PUSH_WRAPUP.md`
- Setup and current data status: `README.md`

## Working Rules
- Keep user-facing behavior stable unless the task explicitly asks for product changes.
- Do not expose `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_KEY`, or `MCP_SERVER_API_KEY` to browser code or `NEXT_PUBLIC_*` env vars.
- Keep agentic retrieval bounded by env limits: `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, `MAX_CONTEXT_TOKENS`.
- Do not change embedding dimensions, Supabase schema, or ingestion behavior during harness-only work.
- Generated harness reports belong in `harness/reports/` and are not source artifacts.

## Verification Shortlist
```bash
python3.10 harness/check_invariants.py
python3.10 harness/run_smoke.py
python3.10 harness/run_memory_eval.py
python3.10 harness/run_eval.py --mode smoke
python3.10 harness/score_quality.py
cd web && npm run build
```
