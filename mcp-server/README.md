# MCP Server

CivilMCP retrieval server using FastAPI + FastMCP-compatible tool handlers.

## Run Local

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
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

Read-only tools exposed by the server:

- `search_civil_knowledge`
- `search_civil_sections`
- `search_civil_chunks`
- `fetch_civil_paper`
- `fetch_chunk_neighbors`
- `fetch_paper_outline`
- `list_papers`
- `list_collections`

Collection-aware tools accept optional `collection`:

- `""` = all collections
- `"ce_project"` = CE Project Database only
- `"ncce"` = NCCE proceedings only

## Retrieval

Production default is `RETRIEVAL_VERSION=v2`:

- `civil_documents_v2`
- `civil_sections_v2`
- `civil_chunks_v2`
- `text-embedding-3-small`
- `EMBEDDING_DIMENSIONS=768`
- section -> chunk two-stage retrieval
- page-aware NCCE citations when page metadata exists

Rollback is env-only: set `RETRIEVAL_VERSION=v1` and redeploy. v1 tables/RPCs remain intact.

## Auth

Set in `.env`:

```bash
REQUIRE_TOOL_AUTH=true
MCP_SERVER_API_KEY=your-random-secret
```

Send either header:

- `Authorization: Bearer your-random-secret`
- `x-mcp-api-key: your-random-secret`
