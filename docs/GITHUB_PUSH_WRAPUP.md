# CivilMCP GitHub Push Wrap-Up

## Repository Scope
This repo should contain source code, schemas, harnesses, docs, and generated paper preview assets required by the web UI.

Do not commit local runtime data:
- `.env`, `.env.local`, or real provider keys
- `CE Project Database/`
- `NCCE Project Database/`
- Python virtualenvs, `node_modules`, `.next`, `.vercel`
- `harness/reports/`
- root QA screenshots

## Current Production State
- CivilMCP web: `https://civil-mcp-web.vercel.app`
- CivilMCP MCP server: `https://civil-mcp-server.vercel.app`
- CityMCP ops dashboard: `https://citymcp.vercel.app`
- Retrieval substrate: Supabase pgvector v2
- Embedding: `text-embedding-3-small`, `EMBEDDING_DIMENSIONS=768`
- Current release gate: `make release-gate`

## Latest Validation
Last local preparation check:
- `make local-gate`: pass
- `make prod-smoke`: pass
- `harness/score_quality.py`: pass, score `100.0`

## First Push Flow
Create a new empty GitHub repo, then run:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

If using HTTPS:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## Update Flow
Before future pushes:

```bash
make release-gate
git status -sb
git add <changed-files>
git commit -m "<short update>"
git push
```

## Required Deploy Secrets
Keep these in Vercel/Supabase/GitHub secrets only, never in source:
- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY`
- `MCP_SERVER_API_KEY`
- `SUPABASE_DB_URL`
- `OPS_DASHBOARD_BASIC_AUTH_USER`
- `OPS_DASHBOARD_BASIC_AUTH_PASSWORD`

## GitHub CI Optional Production Smoke
Set these only after the repo exists:
- Repository variable `RUN_PRODUCTION_SMOKE=true`
- Repository variable `PRODUCTION_MCP_URL=https://civil-mcp-server.vercel.app`
- Repository variable `PRODUCTION_WEB_URL=https://civil-mcp-web.vercel.app`
- Repository secret `MCP_SERVER_API_KEY`

For CityMCP ops smoke:
- Repository variable `RUN_OPS_PRODUCTION_SMOKE=true`
- Repository variable `RUN_OPS_BROWSER_E2E=true`
- Repository variable `OPS_DASHBOARD_URL=https://citymcp.vercel.app`
- Repository secrets `OPS_DASHBOARD_BASIC_AUTH_USER`, `OPS_DASHBOARD_BASIC_AUTH_PASSWORD`
