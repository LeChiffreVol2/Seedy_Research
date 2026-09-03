PYTHON ?= $(shell if [ -x .venv310/bin/python ]; then printf .venv310/bin/python; else printf python3.10; fi)
PROD_MCP_URL ?= https://civil-mcp-server.vercel.app
PROD_WEB_URL ?= https://seedresearch.vercel.app

.PHONY: fixture-check fixture-browser local-gate prod-smoke native-scale release-gate

# Contract checks only: no live database, provider keys, or corpus ingestion.
fixture-check:
	$(PYTHON) harness/check_invariants.py
	$(PYTHON) harness/test_ga_security.py
	$(PYTHON) -m unittest harness.test_repository_docs harness.test_data_quality_integrity pipeline.test_audit_openalex_visibility pipeline.test_reader_pack pipeline.test_pmc_thai_reader_pack pipeline.test_native_reader_cohort pipeline.test_native_portfolio pipeline.test_source_registry harness.test_native_scale harness.test_research_graph_migration
	cd web && node --test lib/*.test.mjs

# An empty environment prevents inherited production keys from reaching tests.
fixture-browser:
	cd web && env -i PATH="$(PATH)" HOME="$(HOME)" CI=1 PLAYWRIGHT_FIXTURES=1 npm run test:e2e -- tests/e2e/webmcp.spec.ts tests/e2e/paper-reader.spec.ts tests/e2e/openalex-connections.spec.ts

local-gate:
	$(PYTHON) -m py_compile $$(find harness mcp-server pipeline supabase eval -name '*.py' -type f | sort)
	$(PYTHON) harness/check_invariants.py
	$(PYTHON) harness/run_data_quality.py
	cd web && npm run build

prod-smoke:
	MCP_URL=$(PROD_MCP_URL) WEB_URL=$(PROD_WEB_URL) $(PYTHON) harness/run_smoke.py --strict

native-scale:
	WEB_URL=$(PROD_WEB_URL) $(PYTHON) harness/run_native_scale.py --strict

release-gate: fixture-check local-gate prod-smoke
	$(PYTHON) harness/score_quality.py
