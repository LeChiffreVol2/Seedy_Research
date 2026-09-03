# Seedy Research GitHub Publication

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

## Repository identity

Keep the existing public repository and history:
[LeChiffreVol2/Seedy_Research](https://github.com/LeChiffreVol2/Seedy_Research).
Verify `git remote -v` before pushing; do not create a replacement repository.
CityMCP recovery and retained identifiers are documented in
[Compatibility](LEGACY_COMPATIBILITY.md).

## Update Flow
For documentation and test-only updates, run `make fixture-check`, verify the
credential-free browser gate in a clean checkout, and inspect the diff. For
runtime releases, also run the live release gates in [Operations](OPERATIONS.md).

```bash
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
Configure these in the existing repository's protected environments:
- Repository variable `PRODUCTION_MCP_URL=https://civil-mcp-server.vercel.app`
- Repository variable `PRODUCTION_WEB_URL=https://seedresearch.vercel.app`
- Repository variable `CORPUS_FINGERPRINT`
- Repository variable `GA_PROMOTION_ENABLED=true` only after all GA gates pass
- Repository secrets for Vercel org/project IDs and `MCP_HARNESS_API_KEY`
- Repository secrets `SUPABASE_PREVIEW_DB_URL` and `SUPABASE_DB_URL` for additive migration steps
- Protect the GitHub `production` environment with required reviewers

Pushes and pull requests run source/fixture gates. Preview deployment also
requires `PREVIEW_RELEASE_ENABLED=true` and the configured environment secrets;
a skipped deployment is not deployment evidence. Use manual
`workflow_dispatch` with `promote=true` after preview QA. The protected job
creates staged Production deployments, tests them, and promotes those exact
deployments without rebuilding. Documentation-only changes do not require
redeploying the application.
