# CityMCP

CityMCP is the smart-city operations consumer that shares CivilMCP's read-only MCP retrieval service and Supabase migration ledger. It is intentionally isolated from the CivilMCP Build Week product and quality score.

> **Status — archived / maintenance-only (1 September 2026):** source code,
> migrations, and the existing deployment are retained. Scheduled GitHub
> refreshes are paused; `.github/workflows/citymcp-ingest.yml` remains available
> only through an explicit manual dispatch. This status does not affect Seedy
> Research release gates or production traffic.

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
- Re-enabling scheduled ingest requires a separate CityMCP decision, a matching
  `OPS_INGEST_SECRET` in GitHub and Vercel, and a CityMCP-only verification run.
