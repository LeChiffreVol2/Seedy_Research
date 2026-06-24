from __future__ import annotations

from common import ROOT, Check, latest_report, make_report, print_report, write_report

PRODUCTION_WEB_URL = "https://civil-mcp-web.vercel.app"
PRODUCTION_MCP_URL = "https://civil-mcp-server.vercel.app"


def command_for_report(report_name: str) -> str:
    commands = {
        "invariants": "python3.10 harness/check_invariants.py",
        "smoke": "python3.10 harness/run_smoke.py",
        "eval_smoke": "python3.10 harness/run_eval.py --mode smoke",
        "memory_eval": "python3.10 harness/run_memory_eval.py",
        "ops_invariants": "python3.10 harness/check_ops_invariants.py --strict",
        "ops_api_contracts": "python3.10 harness/run_ops_api_contracts.py",
        "ops_browser_e2e": "python3.10 harness/run_ops_browser_e2e.py",
    }
    return commands.get(report_name, f"python3.10 harness/{report_name}.py")


def report_check(name: str, report_name: str, required: bool = True) -> Check:
    report = latest_report(report_name)
    if not report:
        status = "fail" if required else "warn"
        return Check(name, status, f"Missing harness/reports/latest_{report_name}.json", f"Run {command_for_report(report_name)}")
    status = report.get("status", "fail")
    return Check(name, status, f"{report_name} status={status}; generatedAt={report.get('generatedAt')}")


def eval_quality_check() -> Check:
    report = latest_report("eval_smoke")
    if not report:
        return Check("answer_and_citation_quality", "warn", "No eval smoke report found.", "Run python3.10 harness/run_eval.py --mode smoke.")
    metrics = report.get("metrics") or {}
    citation_coverage_raw = metrics.get("citationCoverage")
    if report.get("status") == "fail":
        return Check("answer_and_citation_quality", "fail", "Eval smoke has failed checks.", "Inspect latest_eval_smoke.json.", metrics=metrics)
    if citation_coverage_raw is None:
        return Check(
            "answer_and_citation_quality",
            "warn",
            "Eval smoke ran in context-only mode; citation markers were not measured.",
            "Run python3.10 harness/run_eval.py --mode smoke for full answer/citation validation.",
            metrics=metrics,
        )
    citation_coverage = float(citation_coverage_raw)
    citation_correctness_raw = metrics.get("citationCorrectness")
    citation_correctness = float(citation_correctness_raw) if citation_correctness_raw is not None else 0.0
    if citation_coverage < 1:
        return Check("answer_and_citation_quality", "warn", f"citationCoverage={citation_coverage}", "Run full debug eval and inspect evidence requirements.", metrics=metrics)
    if citation_correctness < 1:
        return Check(
            "answer_and_citation_quality",
            "warn",
            f"citationCoverage={citation_coverage}; citationCorrectness={citation_correctness}",
            "Inspect citation IDs and evidence metadata in latest_eval_smoke.json.",
            metrics=metrics,
        )
    return Check("answer_and_citation_quality", "pass", "Eval smoke citation coverage and correctness are complete.", metrics=metrics)


def latency_cost_slo_check() -> Check:
    report = latest_report("eval_smoke")
    if not report:
        return Check("latency_cost_slo", "warn", "No eval smoke report found.", "Run python3.10 harness/run_eval.py --mode smoke.")
    metrics = report.get("metrics") or {}
    slo = metrics.get("slo") or {}
    latency = metrics.get("latency") or {}
    violations = slo.get("violations") if isinstance(slo, dict) else []
    enforced = bool(slo.get("enforced")) if isinstance(slo, dict) else False
    if violations:
        return Check(
            "latency_cost_slo",
            "fail" if enforced else "warn",
            "; ".join(map(str, violations)),
            "Reduce answer length/model latency or raise SLO intentionally.",
            metrics={"slo": slo, "latency": latency},
        )
    return Check("latency_cost_slo", "pass", "Eval latency SLO reporting is within configured limits.", metrics={"slo": slo, "latency": latency})


def data_quality_check() -> Check:
    report = latest_report("data_quality")
    if not report:
        return Check("data_quality", "warn", "No data-quality report found.", "Run python3.10 harness/run_data_quality.py.")
    status = report.get("status", "fail")
    return Check(
        "data_quality",
        status,
        f"Data quality status={status}.",
        "Inspect latest_data_quality.json before the next re-index." if status != "pass" else "",
        metrics=report.get("metrics") or {},
    )


def smoke_quality_check() -> Check:
    report = latest_report("smoke")
    if not report:
        return Check("retrieval_and_feed_health", "warn", "No smoke report found.", "Run python3.10 harness/run_smoke.py.")
    status = report.get("status", "fail")
    return Check(
        "retrieval_and_feed_health",
        status,
        f"Smoke status={status}.",
        "Inspect latest_smoke.json." if status != "pass" else "",
        metrics=report.get("metrics") or {},
    )


def memory_quality_check() -> Check:
    report = latest_report("memory_eval")
    if not report:
        return Check("memory_continuity", "warn", "No memory eval report found.", "Run python3.10 harness/run_memory_eval.py.")
    status = report.get("status", "fail")
    return Check(
        "memory_continuity",
        status,
        f"Memory eval status={status}.",
        "Inspect latest_memory_eval.json." if status != "pass" else "",
        metrics=report.get("metrics") or {},
    )


def ops_quality_check() -> Check:
    reports = {
        "ops_invariants": latest_report("ops_invariants"),
        "ops_api_contracts": latest_report("ops_api_contracts"),
        "ops_browser_e2e": latest_report("ops_browser_e2e"),
    }
    missing_required = [name for name in ["ops_invariants"] if not reports[name]]
    if missing_required:
        return Check("citymcp_ops_quality", "fail", f"Missing required ops reports: {missing_required}", "Run python3.10 harness/check_ops_invariants.py --strict.")
    statuses = {name: report.get("status", "fail") for name, report in reports.items() if report}
    if any(status == "fail" for status in statuses.values()):
        return Check("citymcp_ops_quality", "fail", f"Ops report statuses={statuses}", "Inspect latest ops harness reports.")
    if "ops_api_contracts" not in statuses or "ops_browser_e2e" not in statuses or any(status == "warn" for status in statuses.values()):
        return Check(
            "citymcp_ops_quality",
            "warn",
            f"Ops report statuses={statuses}. API/browser checks should pass before promotion.",
            "Run run_ops_api_contracts.py and run_ops_browser_e2e.py against the target deployment.",
        )
    return Check("citymcp_ops_quality", "pass", f"Ops report statuses={statuses}.")


def deploy_readiness_check() -> Check:
    workflow = ROOT / ".github" / "workflows" / "ci.yml"
    smoke = latest_report("smoke")
    metrics = smoke.get("metrics") if smoke else {}
    has_ci = workflow.exists()
    production_smoke_passed = (
        bool(smoke)
        and smoke.get("status") == "pass"
        and metrics.get("failOnWarn") is True
        and metrics.get("webUrl") == PRODUCTION_WEB_URL
        and metrics.get("mcpUrl") == PRODUCTION_MCP_URL
    )

    if has_ci and production_smoke_passed:
        return Check(
            "deploy_readiness",
            "pass",
            "CI workflow is present and latest strict production smoke passed.",
            metrics=metrics,
        )
    if not has_ci:
        return Check(
            "deploy_readiness",
            "warn",
            "CI workflow is missing.",
            "Add .github/workflows/ci.yml with build and strict smoke gates.",
            metrics=metrics or {},
        )
    return Check(
        "deploy_readiness",
        "warn",
        "CI workflow is present, but latest smoke report is not a strict production pass.",
        (
            "Run MCP_URL=https://civil-mcp-server.vercel.app "
            "WEB_URL=https://civil-mcp-web.vercel.app python3.10 harness/run_smoke.py --strict"
        ),
        metrics=metrics or {},
    )


def main() -> None:
    checks = [
        report_check("architecture_invariants", "invariants", required=True),
        smoke_quality_check(),
        eval_quality_check(),
        latency_cost_slo_check(),
        data_quality_check(),
        memory_quality_check(),
        ops_quality_check(),
        deploy_readiness_check(),
    ]
    pass_count = sum(1 for check in checks if check.status == "pass")
    warn_count = sum(1 for check in checks if check.status == "warn")
    fail_count = sum(1 for check in checks if check.status == "fail")
    score = round((pass_count * 100 + warn_count * 55) / max(1, len(checks)), 1)
    report = make_report(
        "quality_score",
        checks,
        {"score": score, "pass": pass_count, "warn": warn_count, "fail": fail_count},
    )
    path = write_report("quality_score", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
