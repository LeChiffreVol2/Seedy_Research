# MCP Server

CivilMCP retrieval server using FastAPI + FastMCP-compatible tool handlers.

## Run Local

```bash
cd Civil_MCP
cp .env.example .env

cd mcp-server
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

## Endpoints

- `GET /health`
- `GET /metrics`
- `GET /tools/list`
- `POST /tools/call`
- Public stateless MCP v2 transport at `POST /v2/mcp`
- OAuth protected-resource metadata at `GET /.well-known/oauth-protected-resource/v2/mcp`
- Legacy MCP ASGI transport mounted at `/`

`/tools/call` requires API-key auth by default.

## Public MCP v2

The public endpoint exposes 14 high-level contracts:

- discovery: `discover_research`
- paper evidence: `get_paper`, `query_papers`, `compare_papers`, `get_evidence_snapshot`
- research graph: `map_citation_network`
- library read: `list_library`, `list_private_sources`
- library write: `create_library_folder`, `rename_library_folder`, `save_papers`, `move_papers`
- destructive mutations: `delete_library_folder`, `remove_papers`

`discover_research` returns Thai page-cited evidence, Thai journal discovery
metadata, and optional OpenAlex metadata in separate fields. Only records
explicitly marked `citable=true` may support claims. Private PDF packets are
owner-scoped and returned with `shareable=false`.

The v2 endpoint is stateless so serverless instances do not depend on an
in-memory session. Every request is authenticated and charged against the
existing distributed MCP quota.

## Compatibility tools

Evidence and discovery tools (read-only):

- `search_civil_knowledge`
- `search_civil_sections`
- `search_civil_chunks`
- `fetch_civil_paper`
- `fetch_chunk_neighbors`
- `fetch_paper_outline`
- `list_papers`
- `list_collections`
- `search_source_catalog`
- `find_related_papers`
- `list_source_providers`
- `search_global_research` (OpenAlex metadata, never citable)
- `map_citation_network` (OpenAlex metadata, never citable)
- `get_evidence_snapshot`
- `list_library_items` (personal key required)
- `list_private_sources` (personal key required)
- `fetch_private_source_pages` (personal key required)

Owner-scoped library mutations (personal key required):

- `save_library_item` — non-destructive write
- `remove_library_item` — destructive delete

Collection-aware tools accept optional `collection`:

- `""` = all collections
- `"ce_project"` = student civil engineering projects only
- `"ncce"` = NCCE proceedings only

Discovery tools keep evidence boundaries explicit:

- `search_source_catalog` searches indexed, extracted, and metadata-only records.
- `find_related_papers` returns only indexed, page-linked papers.
- `list_source_providers` reports citable and metadata-only totals separately.
- ThaiJO metadata-only records are never returned as evidence by the retrieval tools.

## Retrieval

Production default is `RETRIEVAL_VERSION=v2`:

- `civil_documents_v2`
- `civil_sections_v2`
- `civil_chunks_v2`
- `text-embedding-3-small`
- `EMBEDDING_DIMENSIONS=768`
- section -> chunk two-stage retrieval
- page-aware NCCE citations when page metadata exists

If query embedding fails, v2 search calls the indexed
`search_civil_*_lexical_v2` RPCs and returns the normal evidence contract with
`retrieval_mode=lexical_fallback`, `degraded=true`, and a bounded reason code.
The short embedding circuit breaker prevents a provider outage from causing a
retry storm. `/metrics` and `/health/ready` expose the current circuit state.
If both semantic and lexical retrieval fail, the original typed tool error is
preserved; the web route returns a retryable error and restores answer credits.

Rollback is env-only: set `RETRIEVAL_VERSION=v1` and redeploy. v1 tables/RPCs remain intact.

## Auth

Set in `.env`:

```bash
REQUIRE_TOOL_AUTH=true
MCP_SERVER_API_KEY=your-random-secret
# Optional dedicated CivilMCP web client; store only the raw key's SHA-256 here.
MCP_WEB_API_KEY_SHA256=sha256-hex-without-prefix
```

Send either header:

- `Authorization: Bearer your-random-secret`
- `x-mcp-api-key: your-random-secret`

Signed-in users can create a revocable personal key in CivilMCP Account. A
personal token begins with `cvmcp_`, is shown only once, and is stored as a
SHA-256 hash. It unlocks owner-scoped library/private-source tools; deployment
or CityMCP keys cannot access a user's private records.

Standards-based OAuth 2.1 is available when `MCP_OAUTH_ENABLED=true` and the
matching Supabase OAuth server plus custom access-token hook are enabled.
OAuth access tokens are verified against Supabase Auth on every request, must
be audience-bound to the exact v2 resource, and carry server-enforced CivilMCP
permissions. Personal keys remain the fallback for CLI and automation clients.

```bash
MCP_PUBLIC_URL=https://civil-mcp-server.vercel.app/v2/mcp
MCP_OAUTH_AUDIENCE=https://civil-mcp-server.vercel.app/v2/mcp
MCP_DOCUMENTATION_URL=https://seedresearch.vercel.app/developers
MCP_OAUTH_ENABLED=true
```

Never enable `MCP_OAUTH_ENABLED` before applying
`20260815140000_civil_mcp_oauth_audience_hook.sql` and selecting
`public.civil_mcp_access_token_hook` in Supabase Auth Hooks.
