# Seedy Research Agent Map

This repository is an agent-legible system of record for Seedy Research. Start here, then open only the linked docs needed for the task.

## Product
Seedy Research connects research published in Thailand to global research and an end-to-end research workflow. The Civil Research Pack is the first proof vertical. SeedyMCP is the shared human-agent browser layer; its tool inventory is defined in `web/lib/webmcp.ts`. Workspace reviews selected papers and sends reviewed evidence to the separate Research Notebook. The Python remote MCP service, Supabase store, `civil_*` objects, and stored evidence locators remain compatibility contracts.

## Source Of Truth
- Architecture: `docs/ARCHITECTURE.md`
- Fresh-clone fixtures, live QA, and verification limits: `docs/HARNESS.md`
- Product quality gates: `docs/QUALITY_SCORE.md`
- Launch decision and rollout bar: `docs/LAUNCH_READINESS.md`
- WebMCP Challenge submission and judge flow: `docs/WEBMCP_CHALLENGE_SUBMISSION.md`
- Data-provider expansion and promotion gates: `docs/DATA_EXPANSION.md`
- Full-paper reader, canonical research graph, and national coverage contract: `docs/THAI_RESEARCH_FULL_TEXT_SYSTEM.md`
- Operations and rollback: `docs/OPERATIONS.md`
- GitHub push checklist: `docs/GITHUB_PUSH_WRAPUP.md`
- Product entry point: `README.md`
- Dated corpus counts and integrity limits: `docs/CORPUS_STATUS.md`
- Archive recovery or legacy identifier changes: `docs/LEGACY_COMPATIBILITY.md`

## Working Rules
- Keep user-facing behavior stable unless the task explicitly asks for product changes.
- When a product claim and implementation disagree, report the evidence and ask before reducing scope or hiding a feature; correct demonstrably stale documentation without inventing new guarantees.
- Do not expose `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_KEY`, or `MCP_SERVER_API_KEY` to browser code or `NEXT_PUBLIC_*` env vars.
- Keep agentic retrieval bounded by env limits: `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, `MAX_CONTEXT_TOKENS`.
- Preserve the Research Passport evidence boundary: page-linked Thai packets may support claims after page review; OpenAlex records are metadata-only leads; candidate gaps remain unvalidated and must not be represented as proven novelty or transferability.
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
cd web && npx playwright test tests/e2e/webmcp.spec.ts
```
