# CityMCP

CityMCP is the smart-city operations consumer that shares CivilMCP's read-only MCP retrieval service and Supabase migration ledger. It is intentionally isolated from the CivilMCP Build Week product and quality score.

## Layout

- `ops-dashboard/`: Next.js operations dashboard and API routes.
- `harness/`: CityMCP-only invariants, API contracts, browser checks, and readiness score.
- `Makefile`: local and production CityMCP gates.

## Local gate

```bash
cd citymcp
make local-gate
```

## Shared boundaries

- MCP tool names and read-only contracts remain backward compatible.
- Applied `smart_city_*` migrations remain in the repository-level `supabase/migrations/` ledger.
- CivilMCP CI, release, and quality scoring do not build, deploy, or score this directory.
