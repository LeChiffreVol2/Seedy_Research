PYTHON ?= $(shell if [ -x .venv310/bin/python ]; then printf .venv310/bin/python; else printf python3.10; fi)
PROD_MCP_URL ?= https://civil-mcp-server.vercel.app
PROD_WEB_URL ?= https://seedresearch.vercel.app

.PHONY: local-gate prod-smoke native-scale release-gate

local-gate:
	$(PYTHON) -m py_compile $$(find harness mcp-server pipeline supabase eval -name '*.py' -type f | sort)
	$(PYTHON) harness/check_invariants.py
	$(PYTHON) harness/run_data_quality.py
	cd web && npm run build

prod-smoke:
	MCP_URL=$(PROD_MCP_URL) WEB_URL=$(PROD_WEB_URL) $(PYTHON) harness/run_smoke.py --strict

native-scale:
	WEB_URL=$(PROD_WEB_URL) $(PYTHON) harness/run_native_scale.py --strict

release-gate: local-gate prod-smoke
	$(PYTHON) harness/score_quality.py
