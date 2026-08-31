from __future__ import annotations

import os
from datetime import datetime, timezone

from common import ROOT, Check, latest_report, make_report, print_report, report_provenance, write_report

PRODUCTION_WEB_URL = "https://seedresearch.vercel.app"
PRODUCTION_MCP_URL = "https://civil-mcp-server.vercel.app"


def provenance_failure(name: str, report_name: str, report: dict | None, required: bool = True) -> Check | None:
    if not report:
        status = "fail" if required else "warn"
        return Check(name, status, f"Missing harness/reports/latest_{report_name}.json", f"Run {command_for_report(report_name)}")

    problems: list[str] = []
    generated_at = report.get("generatedAt")
    try:
        generated = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - generated.astimezone(timezone.utc)).total_seconds() / 3600
        max_age = max(1.0, float(os.getenv("HARNESS_MAX_REPORT_AGE_HOURS", "24")))
        if age_hours > max_age:
            problems.append(f"stale={age_hours:.1f}h>{max_age:.1f}h")
    except (TypeError, ValueError):
        problems.append("generatedAt is invalid")

    actual = report.get("provenance")
    expected = report_provenance()
    if not isinstance(actual, dict) or actual.get("formatVersion") != expected.get("formatVersion"):
        problems.append("missing current provenance format")
    else:
        for key in ["gitSha", "gitDirty", "sourceFingerprint", "schemaMigration"]:
            if actual.get(key) != expected.get(key):
                problems.append(f"{key} mismatch")
        expected_corpus = expected.get("corpusFingerprint")
        actual_corpus = actual.get("corpusFingerprint")
        if expected_corpus != "unavailable" and actual_corpus != expected_corpus:
            problems.append("corpusFingerprint mismatch")
        expected_target = os.getenv("HARNESS_EXPECTED_TARGET", "").strip()
        if expected_target and actual.get("target") != expected_target:
            problems.append(f"target={actual.get('target')} expected={expected_target}")
        expected_deployments = expected.get("deploymentUrls") or {}
        if expected_deployments and actual.get("deploymentUrls") != expected_deployments:
            problems.append("deploymentUrls mismatch")
        expected_deployment_id = expected.get("deploymentId")
        if expected_deployment_id and actual.get("deploymentId") != expected_deployment_id:
            problems.append("deploymentId mismatch")

    if problems:
        return Check(
            name,
            "fail" if required else "warn",
            f"{report_name} provenance invalid: {'; '.join(problems)}",
            f"Regenerate with {command_for_report(report_name)} against the candidate deployment.",
        )
    return None


def command_for_report(report_name: str) -> str:
    commands = {
        "invariants": "python3.10 harness/check_invariants.py",
        "smoke": "python3.10 harness/run_smoke.py",
        "eval_smoke": "python3.10 harness/run_eval.py --mode smoke",
        "memory_eval": "python3.10 harness/run_memory_eval.py",
    }
    return commands.get(report_name, f"python3.10 harness/{report_name}.py")


def report_check(name: str, report_name: str, required: bool = True) -> Check:
    report = latest_report(report_name)
    invalid = provenance_failure(name, report_name, report, required)
    if invalid:
        return invalid
    assert report is not None
    status = report.get("status", "fail")
    return Check(name, status, f"{report_name} status={status}; generatedAt={report.get('generatedAt')}")


def eval_quality_check() -> Check:
    report = latest_report("eval_smoke")
    invalid = provenance_failure("answer_and_citation_quality", "eval_smoke", report)
    if invalid:
        return invalid
    assert report is not None
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
    invalid = provenance_failure("latency_cost_slo", "eval_smoke", report)
    if invalid:
        return invalid
    assert report is not None
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
    invalid = provenance_failure("data_quality", "data_quality", report)
    if invalid:
        return invalid
    assert report is not None
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
    invalid = provenance_failure("retrieval_and_feed_health", "smoke", report)
    if invalid:
        return invalid
    assert report is not None
    metrics = report.get("metrics") or {}
    if metrics.get("webOnly") or metrics.get("mcpOnly"):
        return Check(
            "retrieval_and_feed_health",
            "fail",
            "Latest smoke report is partial; a full MCP + web run is required.",
            "Run python3.10 harness/run_smoke.py --strict.",
            metrics=metrics,
        )
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
    invalid = provenance_failure("memory_continuity", "memory_eval", report)
    if invalid:
        return invalid
    assert report is not None
    status = report.get("status", "fail")
    return Check(
        "memory_continuity",
        status,
        f"Memory eval status={status}.",
        "Inspect latest_memory_eval.json." if status != "pass" else "",
        metrics=report.get("metrics") or {},
    )


def deploy_readiness_check() -> Check:
    workflow = ROOT / ".github" / "workflows" / "preview-release.yml"
    smoke = latest_report("smoke")
    invalid = provenance_failure("deploy_readiness", "smoke", smoke)
    if invalid:
        return invalid
    metrics = smoke.get("metrics") if smoke else {}
    workflow_text = workflow.read_text(encoding="utf-8", errors="replace") if workflow.exists() else ""
    has_ci = workflow.exists() and all(
        marker in workflow_text
        for marker in ("stage-production:", "production-candidate-smoke:", "--prod --skip-domain", "GA_PROMOTION_ENABLED")
    )
    candidate_smoke_passed = (
        bool(smoke)
        and smoke.get("status") == "pass"
        and metrics.get("failOnWarn") is True
        and not metrics.get("webOnly")
        and not metrics.get("mcpOnly")
        and isinstance(smoke.get("provenance"), dict)
        and smoke["provenance"].get("target") in {"preview", "production"}
    )

    if has_ci and candidate_smoke_passed:
        return Check(
            "deploy_readiness",
            "pass",
            "Preview/promote CI is present and the latest strict candidate smoke passed.",
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
        "Preview/promote CI is present, but latest smoke report is not a strict preview or production pass.",
        (
            "Run MCP_URL=https://civil-mcp-server.vercel.app "
            "WEB_URL=https://seedresearch.vercel.app python3.10 harness/run_smoke.py --strict"
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
