# CivilMCP GitHub Push Wrap-Up

## Repository Scope
This repo should contain source code, schemas, harnesses, and docs. Generated reports, source PDFs/markdown, root ZIP archives, secrets, and runtime build artifacts stay out of Git.

Do not commit local runtime data:
- `.env`, `.env.local`, or real provider keys
- `CE Project Database/`
- `NCCE Project Database/`
- Python virtualenvs, `node_modules`, `.next`, `.vercel`
- `harness/reports/`
- root QA screenshots and ZIP handoff bundles

## Current Production State
- Seedy Research web: `https://seedresearch.vercel.app`
- CivilMCP MCP server: `https://civil-mcp-server.vercel.app`
- Retrieval substrate: Supabase pgvector v2
- Embedding: `text-embedding-3-small`, `EMBEDDING_DIMENSIONS=768`
- Current release gate: `make release-gate`

## Latest Validation
Do not reuse an old readiness score. Reports are valid for at most 24 hours and must match the exact source/deployment provenance.

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
- `MCP_CLIENT_KEYS_JSON`
- `MCP_HARNESS_API_KEY`
- `GUEST_SESSION_HMAC_KEY`
- `SUPABASE_DB_URL`

## GitHub Preview And Promotion
Set these after the private repo exists:
- Repository variable `PRODUCTION_MCP_URL=https://civil-mcp-server.vercel.app`
- Repository variable `PRODUCTION_WEB_URL=https://seedresearch.vercel.app`
- Repository variable `CORPUS_FINGERPRINT`
- Repository variable `GA_PROMOTION_ENABLED=true` only after all GA gates pass
- Repository secrets for Vercel org/project IDs and `MCP_HARNESS_API_KEY`
- Repository secrets `SUPABASE_PREVIEW_DB_URL` and `SUPABASE_DB_URL` for additive migration steps
- Protect the GitHub `production` environment with required reviewers

Pushes and pull requests create Preview deployments only. Use manual `workflow_dispatch` with `promote=true` after preview QA; the protected job creates staged Production deployments, tests them, and promotes those exact deployments without another rebuild.
