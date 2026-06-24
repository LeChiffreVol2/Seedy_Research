from __future__ import annotations

import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urljoin

from common import ROOT, Check, http_json, is_connection_error, make_report, print_report, write_report


DEFAULT_BASE_URL = "http://localhost:3000"


def load_ops_env() -> dict[str, str]:
    env = dict(os.environ)
    for path in [ROOT / ".env", ROOT / ".env.local", ROOT / "ops-dashboard" / ".env.local"]:
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in env:
                env[key] = value
    return env


def auth_headers(env: dict[str, str]) -> dict[str, str]:
    user = (
        env.get("OPS_DASHBOARD_BASIC_AUTH_USER")
        or env.get("OPS_API_BASIC_AUTH_USER")
        or env.get("OPS_BASIC_AUTH_USER")
    )
    password = (
        env.get("OPS_DASHBOARD_BASIC_AUTH_PASSWORD")
        or env.get("OPS_API_BASIC_AUTH_PASSWORD")
        or env.get("OPS_BASIC_AUTH_PASSWORD")
    )
    if not user or not password:
        return {}
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def endpoint_url(base_url: str, path: str) -> str:
    return urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))


def shape_at(payload: Any, path: str) -> Any:
    current = payload
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def check_get_contract(base_url: str, headers: dict[str, str], name: str, path: str, required_shapes: dict[str, type]) -> Check:
    url = endpoint_url(base_url, path)
    try:
        status, payload, latency_ms = http_json("GET", url, headers=headers, timeout=45)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(name, "fail", f"Connection error for {url}: {exc}", "Start ops-dashboard or set OPS_DASHBOARD_URL.")
        raise

    missing = []
    for key, expected_type in required_shapes.items():
        value = shape_at(payload, key)
        if not isinstance(value, expected_type):
            missing.append(f"{key}:{expected_type.__name__}")
    ok = 200 <= status < 300 and not missing
    return Check(
        name,
        "pass" if ok else "fail",
        f"HTTP {status}; missing_or_wrong_shape={missing}",
        "Fix the ops API response contract or route availability." if not ok else "",
        latency_ms=latency_ms,
        metrics={"httpStatus": status},
    )


def check_negative_contract(
    base_url: str,
    headers: dict[str, str],
    name: str,
    path: str,
    body: dict[str, Any] | None,
    expected_statuses: set[int],
    method: str = "POST",
) -> Check:
    url = endpoint_url(base_url, path)
    try:
        status, payload, latency_ms = http_json(method, url, body=body, headers=headers, timeout=45)
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(name, "fail", f"Connection error for {url}: {exc}", "Start ops-dashboard or set OPS_DASHBOARD_URL.")
        raise

    ok = status in expected_statuses
    error_text = ""
    if isinstance(payload, dict):
        error_text = str(payload.get("error") or payload.get("message") or "")[:240]
    return Check(
        name,
        "pass" if ok else "fail",
        f"HTTP {status}; error={error_text}",
        f"Expected one of {sorted(expected_statuses)} for guarded negative contract." if not ok else "",
        latency_ms=latency_ms,
        metrics={"httpStatus": status},
    )


def check_binary_contract(
    base_url: str,
    headers: dict[str, str],
    name: str,
    path: str,
    expected_statuses: set[int],
    expected_content_type: str | None = None,
) -> Check:
    url = endpoint_url(base_url, path)
    request = urllib.request.Request(url, headers=headers, method="GET")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read()
            latency_ms = (time.perf_counter() - started) * 1000
            content_type = response.headers.get("content-type", "")
            ok = response.status in expected_statuses and (not expected_content_type or expected_content_type in content_type or response.status == 204)
            return Check(
                name,
                "pass" if ok else "fail",
                f"HTTP {response.status}; bytes={len(body)}; contentType={content_type}",
                f"Expected {sorted(expected_statuses)} and content type {expected_content_type}." if not ok else "",
                latency_ms=latency_ms,
                metrics={"httpStatus": response.status, "bytes": len(body)},
            )
    except urllib.error.HTTPError as exc:
        body = exc.read()
        latency_ms = (time.perf_counter() - started) * 1000
        ok = exc.code in expected_statuses
        return Check(
            name,
            "pass" if ok else "fail",
            f"HTTP {exc.code}; bytes={len(body)}",
            f"Expected one of {sorted(expected_statuses)}." if not ok else "",
            latency_ms=latency_ms,
            metrics={"httpStatus": exc.code, "bytes": len(body)},
        )
    except BaseException as exc:
        if is_connection_error(exc):
            return Check(name, "fail", f"Connection error for {url}: {exc}", "Start ops-dashboard or set OPS_DASHBOARD_URL.")
        raise


def bad_research_gate_body() -> dict[str, Any]:
    return {
        "objectIds": ["incident:itic-live-events:not-real"],
        "insight": {
            "id": "insight:missing-evidence",
            "domain": "transport",
            "objectId": "incident:itic-live-events:not-real",
            "objectType": "incident",
            "title": "Missing evidence gate probe",
            "whyNow": "Contract probe only.",
            "evidence": [],
            "recommendedAction": "Do not record an action.",
            "nextVerificationStep": "Reject this request.",
            "severity": "medium",
            "confidence": 0.5,
            "riskBefore": 50,
            "expectedRiskAfter": 45,
            "delta": -5,
            "sourceObjectIds": [],
            "evidenceIds": [],
            "caveat": "Missing evidence.",
            "requiresResearch": True,
            "generatedAt": "2026-06-11T00:00:00Z",
        },
    }


def synthetic_research_gate_body() -> dict[str, Any]:
    return {
        "objectIds": ["synthetic:ops-contract-probe"],
        "insight": {
            "id": "synthetic:insight:ops-contract-probe",
            "domain": "transport",
            "objectId": "synthetic:ops-contract-probe",
            "objectType": "incident",
            "title": "Synthetic ops contract probe",
            "whyNow": "Contract probe only.",
            "evidence": [{"label": "source", "value": "synthetic", "kind": "live"}],
            "recommendedAction": "Do not record an action.",
            "nextVerificationStep": "Reject this request.",
            "severity": "medium",
            "confidence": 0.5,
            "riskBefore": 50,
            "expectedRiskAfter": 45,
            "delta": -5,
            "sourceObjectIds": ["synthetic:ops-contract-probe"],
            "evidenceIds": ["mcp:synthetic-evidence"],
            "caveat": "Synthetic marker must be rejected.",
            "requiresResearch": True,
            "generatedAt": "2026-06-11T00:00:00Z",
        },
    }


def build_checks(base_url: str, headers: dict[str, str]) -> list[Check]:
    checks = [
        check_get_contract(
            base_url,
            headers,
            "ops_overview_contract",
            "/api/ops/overview",
            {"generatedAt": str, "sources": list, "sourceHealth": list, "events": list, "assets": list, "hotspots": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_layers_registry_contract",
            "/api/ops/layers/registry",
            {"generatedAt": str, "layers": list, "sourceHealth": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_layers_bbox_contract",
            "/api/ops/layers?bbox=100.3,13.5,100.9,14.0&zoom=11&types=incidents,rail&limit=25",
            {"type": str, "features": list, "page": dict},
        ),
        check_binary_contract(
            base_url,
            headers,
            "ops_layers_mvt_contract",
            "/api/ops/tiles/10/798/466.mvt?types=incidents,rail",
            expected_statuses={200, 204},
            expected_content_type="application/vnd.mapbox-vector-tile",
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_sources_sla_contract",
            "/api/ops/sources/sla",
            {"generatedAt": str, "summary": dict, "sources": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_ontology_objects_contract",
            "/api/ops/ontology/objects?type=rail_crossing",
            {"generatedAt": str, "objects": list, "links": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_insights_contract",
            "/api/ops/insights?domain=transport&limit=5",
            {"generatedAt": str, "domain": str, "count": int, "insights": list, "hotPath": str, "readModel": str},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_rail_overview_contract",
            "/api/ops/rail/overview",
            {"generatedAt": str, "sources": list, "sourceHealth": list, "crossings": list, "events": list, "cases": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_actions_log_contract",
            "/api/ops/actions/log",
            {"records": list},
        ),
        check_get_contract(
            base_url,
            headers,
            "ops_commands_log_contract",
            "/api/ops/commands/log?limit=5",
            {"commands": list},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_ingest_unauth_rejected",
            "/api/ops/ingest/refresh",
            body={},
            expected_statuses={401, 503},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_bad_action_record_rejected",
            "/api/ops/actions/record",
            body={},
            expected_statuses={422},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_bad_command_execute_rejected",
            "/api/ops/commands/execute",
            body={},
            expected_statuses={422},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_unknown_command_type_rejected",
            "/api/ops/commands/execute",
            body={"commands": [{"type": "unknown_command", "reason": "contract probe"}]},
            expected_statuses={422},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_rail_execute_legacy_payload_rejected",
            "/api/ops/rail/execute",
            body={
                "railCase": {"id": "rail-case:real", "name": "Forged rail case"},
                "proposal": {
                    "id": "rail-signal-barrier-audit",
                    "title": "Forged rail action",
                    "simulation": {
                        "beforeRisk": 80,
                        "afterExpectedRisk": 60,
                        "delta": -20,
                        "confidence": 0.9,
                        "evidenceBasis": ["forged citation"],
                        "caveat": "forged",
                    },
                },
            },
            expected_statuses={422},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_bad_action_transition_rejected",
            "/api/ops/actions/not-real/transition",
            body={"toStatus": "closed"},
            expected_statuses={422, 404},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_invalid_layer_cursor_rejected",
            "/api/ops/layers?bbox=100.3,13.5,100.9,14.0&cursor=bad-cursor",
            body=None,
            expected_statuses={400},
            method="GET",
        ),
        check_binary_contract(
            base_url,
            headers,
            "ops_invalid_tile_rejected",
            "/api/ops/tiles/99/0/0.mvt",
            expected_statuses={400},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_bad_research_gate_rejected",
            "/api/ops/research-gate",
            body=bad_research_gate_body(),
            expected_statuses={422},
        ),
        check_negative_contract(
            base_url,
            headers,
            "ops_synthetic_ids_rejected",
            "/api/ops/research-gate",
            body=synthetic_research_gate_body(),
            expected_statuses={422},
        ),
    ]
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description="Run non-destructive ops-dashboard API contract checks.")
    parser.add_argument("--base-url", help="Ops dashboard base URL. Defaults to OPS_DASHBOARD_URL or localhost:3000.")
    parser.add_argument("--json-only", action="store_true", help="Print the full JSON report without writing harness/reports files.")
    args = parser.parse_args()

    env = load_ops_env()
    base_url = (args.base_url or env.get("OPS_DASHBOARD_URL") or DEFAULT_BASE_URL).rstrip("/")
    headers = auth_headers(env)
    report = make_report(
        "ops_api_contracts",
        build_checks(base_url, headers),
        metrics={"baseUrl": base_url, "basicAuthConfigured": bool(headers)},
    )

    if args.json_only:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        path = write_report("ops_api_contracts", report)
        print_report(report, path)

    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
