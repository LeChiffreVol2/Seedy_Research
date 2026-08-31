# Smart City Ops Dashboard

Isolated Thailand/SEA transport safety operations dashboard for CivilMCP.

This app is intentionally separate from the production chatbot in `../web`.

## Run Local

```bash
cd citymcp/ops-dashboard
npm install
npm run dev
```

Default URL:

```text
http://localhost:3000
```

If `../web` is already running on port `3000`, Next.js will offer another port.

## Boundaries

- Do not change `../web/app/page.tsx`, chatbot session behavior, or chatbot API contracts for dashboard work.
- CivilMCP is used through `MCP_URL` as a read-only evidence service.
- Smart-city database objects use the `smart_city_*` prefix only.

## APIs

- `GET /api/ops/overview` returns map events, hotspots, assets, and source health.
- `POST /api/ops/analyst` calls CivilMCP read-only retrieval and returns a transport-safety guidance brief.
- `POST /api/ops/research` runs the CivilMCP research-gate flow and returns evidence-backed recommended actions.
- `GET /api/ops/ontology/objects` returns the normalized object graph used by the map and dossier panels.
- `GET /api/ops/insights` returns precomputed actionable insights from real-source objects only; no LLM is in the hot path.
- `GET /api/ops/layers/registry` returns spatial layer metadata, truth labels, counts, freshness, health, and render defaults.
- `GET /api/ops/layers?bbox=&zoom=&types=&since=` returns bounded GeoJSON for the current map viewport.
- `POST /api/ops/ingest/refresh` refreshes the Supabase/PostGIS read model and requires `OPS_INGEST_SECRET`.
- `GET /api/ops/ingest/refresh` is the Vercel Cron path and requires `Authorization: Bearer $CRON_SECRET`.
- `POST /api/ops/research-gate` calls CivilMCP read-only retrieval for the selected object and returns recommended actions only when citations exist.
- `POST /api/ops/actions/record` persists a controlled action record with actor, source objects, evidence ids, and expected risk delta.
- `GET /api/ops/rail/overview` returns SRT level-crossing cases, rail signals, source health, and simulation summaries.
- `POST /api/ops/rail/research` runs CivilMCP read-only rail research and returns expected before/after risk deltas.
- `POST /api/ops/rail/execute` records a local rail action only.

## Data Sources

The v1 source layer is Thailand-first and adapter-driven:

- Bangkok traffic/CCTV references: https://traffic.bangkok.go.th/AboutUS/dev.html
- DOH travel signals: https://www.thailand.go.th/public/issue-focus-detail/001_08_028
- iTIC / Longdo live traffic events: https://event.longdo.com/feed/json
- iTIC historical traffic/incident data: https://itic.longdo.com/data/
- Open Government traffic datasets: https://www.data.go.th/th/dataset/index-traffic

Runtime data is real-data-only. When a feed is not configured or has no usable
coordinates, the dashboard leaves the layer empty and marks the connector as
`needs_config`, `stale`, or `offline`; it does not render seeded pilot data.

## Supabase / Vercel

The dashboard uses a durable `smart_city_*` Supabase/PostGIS read model:
`smart_city_events`, `smart_city_hotspots`, `smart_city_objects`,
`smart_city_links`, `smart_city_insights`, `smart_city_research_runs`, and
`smart_city_research_evidence`, alongside existing sources, source health,
assets, and action records. API routes read PostGIS first and fall back to
request-time adapters only for local/unconfigured environments.

Action records are persisted in `smart_city_action_records` when
`SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are configured. Smart-city tables have
RLS enabled and are intended for server-side service-role access only.

Apply the dashboard schema before deploying:

```bash
supabase db push --workdir ../../supabase
```

Required Vercel environment variables for the isolated dashboard project:

```text
SUPABASE_URL
SUPABASE_SERVICE_KEY
OPS_DASHBOARD_BASIC_AUTH_USER
OPS_DASHBOARD_BASIC_AUTH_PASSWORD
OPS_RBAC_POLICY_JSON
MCP_URL
MCP_SERVER_API_KEY
SMART_CITY_OSIRIS_BASE_URL
SMART_CITY_OSIRIS_CCTV_REGION
SMART_CITY_OSIRIS_TIMEOUT_MS
SMART_CITY_OSIRIS_MAX_ROWS_PER_FEED
SMART_CITY_READ_MODEL_CACHE_TTL_MS
OPS_INGEST_SECRET
CRON_SECRET
SMART_CITY_INGEST_BATCH_LIMIT
SMART_CITY_LAYER_MAX_FEATURES
SMART_CITY_TILE_MAX_ZOOM
```

### Archived ingest schedule

Vercel Hobby cron can only run daily, so `citymcp/ops-dashboard/vercel.json` keeps a
daily fallback in the retained deployment configuration. The former five-minute
GitHub refresh is paused while CityMCP is archived in maintenance-only mode.
`.github/workflows/citymcp-ingest.yml` now permits explicit manual dispatch only.

Before deliberately reactivating the CityMCP workflow, configure the GitHub
repository that owns the deployment:

```bash
gh secret set OPS_INGEST_SECRET --body "$OPS_INGEST_SECRET"
gh variable set CITYMCP_INGEST_URL --body "https://citymcp.vercel.app/api/ops/ingest/refresh"
```

`OPS_INGEST_SECRET` must match the Vercel production env var of the same name.
Without that repository secret, CityMCP remains real-data-only but refreshes
only through manual ingest or the daily Vercel fallback.

Manual refresh from a machine that has `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` configured:

```bash
make ops-refresh-read-model
make ops-prod-smoke
```

## Product Architecture Inspiration

This app does not clone Palantir or CARTO proprietary code, UI, trade dress,
copy, logo, or paid platform behavior. The implementation borrows public product
patterns:

- Blueprint: dense, desktop-first command-center controls instead of a loose card dashboard.
- Resource Identifier: stable `ri.smart-city.th.*` object identity in dossiers and action audit trails.
- Plottable / react-layered-chart: composable timeline/read-model thinking, with precomputed insight APIs instead of querying raw feeds in the UI.
- Action logs: action recording is persisted with source objects and evidence ids, without calling external field systems.
- CARTO-style spatial core: durable PostGIS read model, layer registry, viewport-bounded GeoJSON, and typed map commands instead of request-time JSON aggregation.

`JCodesMore/ai-website-cloner-template` may be used only as a scratch/reference
extraction process for screenshots, tokens, component specs, and responsive
behavior sweeps. No third-party cloned assets or copy enter dashboard runtime.

## OSIRIS Ingestion

Set `SMART_CITY_OSIRIS_BASE_URL` to ingest OSIRIS passive feeds into the
dashboard without copying OSIRIS into the production chatbot:

```bash
SMART_CITY_OSIRIS_BASE_URL=https://osirisai.live
SMART_CITY_OSIRIS_CCTV_REGION=asia
```

The adapter currently pulls passive Osiris feeds including earthquakes, fires,
weather, CCTV, maritime, aviation, satellites, global incidents, Telegram/RSS
intel, live news, infrastructure, air quality, country risk, cyber threats,
frontlines, markets/commodities, space weather, and supply-chain suppliers.
Feeds without usable geometry are still monitored as real source-health rows but
do not create map markers. Targeted recon/query tools such as scanner, WHOIS,
DNS, sanctions, crypto wallet lookup, and Sentinel imagery search are not
auto-executed because they require a target and should stay behind an explicit
analyst action.

## Rail Safety Layer

The v1 rail layer is scoped to SRT level crossings. Osiris is used only as a
passive context/news trigger; the dashboard does not assume Osiris has enough
Thailand rail data for decision support by itself.

Optional rail feeds:

```bash
SMART_CITY_RAIL_NEWS_FEED_URL=
SMART_CITY_RAIL_CROSSING_GEOJSON_URL=
```

When these are unset, the rail layer returns no rail cases and labels the live
rail connectors as `needs_config`. CivilMCP rail research is read-only, and
execute records a local controlled action only after a real rail case and cited
CivilMCP-backed recommendation exist.
