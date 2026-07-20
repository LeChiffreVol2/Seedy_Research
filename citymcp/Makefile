PYTHON ?= $(shell if [ -x ../.venv310/bin/python ]; then printf ../.venv310/bin/python; else printf python3.10; fi)
PROD_OPS_DASHBOARD_URL ?= https://citymcp.vercel.app

.PHONY: local-gate refresh-read-model prod-smoke prod-browser-e2e readiness release-gate

local-gate:
	$(PYTHON) harness/check_ops_invariants.py --strict
	cd ops-dashboard && npm test && npm run typecheck && OPS_DASHBOARD_AUTH_DISABLED=true npm run build

refresh-read-model:
	cd ops-dashboard && npx tsx -e 'import { refreshSpatialCoreReadModel } from "./lib/spatial-read-model"; void refreshSpatialCoreReadModel().then((r) => console.log(JSON.stringify({ persisted: r.persisted, ingestRunId: r.ingestRunId, counts: r.counts }, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });'

prod-smoke:
	OPS_DASHBOARD_URL=$(PROD_OPS_DASHBOARD_URL) $(PYTHON) harness/run_ops_api_contracts.py

prod-browser-e2e:
	OPS_E2E_BASE_URL=$(PROD_OPS_DASHBOARD_URL) $(PYTHON) harness/run_ops_browser_e2e.py --strict

readiness:
	$(PYTHON) harness/score_ops_readiness.py

release-gate: local-gate prod-smoke prod-browser-e2e readiness
