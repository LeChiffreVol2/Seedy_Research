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
- MCP ASGI app mounted at `/`

`/tools/call` requires API-key auth by default.

## Tools

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
or CityMCP keys cannot access a user's private records. Standards-based OAuth
2.1 discovery is not claimed in this release.
