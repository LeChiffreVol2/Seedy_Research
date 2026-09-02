#!/usr/bin/env python3
"""Validate the dated, rights-safe acquisition portfolio for 5,000 papers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


PORTFOLIO_VERSION = "seedy-native-source-portfolio-v1"
RIGHTS_STATES = {
    "partially_verified",
    "item_preflight_required",
    "agreement_required",
}


def _positive_int(value: Any, field: str, *, allow_zero: bool = False) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{field} must be an integer.")
    if value < (0 if allow_zero else 1):
        raise ValueError(f"{field} must be {'non-negative' if allow_zero else 'positive'}.")
    return value


def load_portfolio(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != PORTFOLIO_VERSION:
        raise ValueError(f"Unsupported portfolio version: {payload.get('version')!r}")

    target = _positive_int(payload.get("targetNativePapers"), "targetNativePapers")
    current = _positive_int(payload.get("currentNativePapers"), "currentNativePapers", allow_zero=True)
    if target < 5_000 or current > target:
        raise ValueError("Portfolio must preserve a reachable target of at least 5,000 native papers.")

    policy = payload.get("acquisitionPolicy")
    if not isinstance(policy, dict):
        raise ValueError("acquisitionPolicy is required.")
    if policy.get("metadataProtocol") != "ThaiJO OAI-PMH":
        raise ValueError("metadataProtocol must remain the official ThaiJO OAI-PMH route.")
    if policy.get("automatedPdfCrawl") is not False:
        raise ValueError("acquisitionPolicy.automatedPdfCrawl must be false.")
    if policy.get("nativePromotionRequiresApprovedDelivery") is not True:
        raise ValueError("Native promotion must require an approved asset delivery route.")

    sources = payload.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Portfolio requires at least one source.")
    seen: set[str] = set()
    current_sum = 0
    first_wave_candidates = 0
    for source in sources:
        source_id = str(source.get("id", "")).strip()
        if not source_id or source_id in seen:
            raise ValueError(f"Missing or duplicate source id: {source_id!r}")
        seen.add(source_id)
        official_url = str(source.get("officialUrl", "")).strip()
        if urlparse(official_url).scheme != "https" or not urlparse(official_url).netloc:
            raise ValueError(f"Source {source_id} must use an official HTTPS URL.")
        if source.get("rightsState") not in RIGHTS_STATES:
            raise ValueError(f"Source {source_id} has an unsupported rightsState.")
        if source.get("automatedPdfDownload") is not False:
            raise ValueError(f"Source {source_id} automatedPdfDownload must be false.")
        if source.get("rightsState") == "agreement_required":
            official_total = _positive_int(
                source.get("officialScreeningLowerBound"),
                f"{source_id}.officialScreeningLowerBound",
            )
        else:
            official_total = _positive_int(
                source.get("officialScreeningCeiling"),
                f"{source_id}.officialScreeningCeiling",
            )
        screening = _positive_int(source.get("screeningCandidates"), f"{source_id}.screeningCandidates", allow_zero=True)
        verified = _positive_int(source.get("currentNativePapers"), f"{source_id}.currentNativePapers", allow_zero=True)
        if screening > official_total or verified > official_total:
            raise ValueError(f"Source {source_id} exceeds its official screening ceiling.")
        if verified and source.get("rightsState") != "partially_verified":
            raise ValueError(f"Source {source_id} counts native papers without a partially_verified state.")
        current_sum += verified
        if source.get("firstMilestoneWave") is True:
            first_wave_candidates += screening

    if current_sum != current:
        raise ValueError(
            f"currentNativePapers={current} does not match verified source total {current_sum}."
        )
    milestone = payload.get("firstMilestone")
    if not isinstance(milestone, dict) or milestone.get("targetNativePapers") != 1_000:
        raise ValueError("firstMilestone.targetNativePapers must be 1,000.")
    if milestone.get("screeningCandidates") != first_wave_candidates:
        raise ValueError("firstMilestone.screeningCandidates does not match its source wave.")
    if payload.get("agreementRequiredFor5000") is not True:
        raise ValueError("The 5,000-paper target must remain agreement-backed.")
    return payload


def portfolio_summary(portfolio: dict[str, Any]) -> dict[str, Any]:
    current = portfolio["currentNativePapers"]
    target = portfolio["targetNativePapers"]
    milestone = portfolio["firstMilestone"]
    milestone_required = milestone["targetNativePapers"] - current
    screening = milestone["screeningCandidates"]
    public_screening = sum(
        source["screeningCandidates"]
        for source in portfolio["sources"]
        if source["rightsState"] != "agreement_required"
    )
    agreement_lower_bound = sum(
        source["officialScreeningLowerBound"]
        for source in portfolio["sources"]
        if source["rightsState"] == "agreement_required"
    )
    net_new_required = target - current
    return {
        "status": "portfolio_valid",
        "asOf": portfolio["asOf"],
        "targetNativePapers": target,
        "currentNativePapers": current,
        "netNewRequired": net_new_required,
        "sourceCount": len(portfolio["sources"]),
        "agreementRequiredFor5000": portfolio["agreementRequiredFor5000"],
        "publicLicenseNetNewScreeningPool": public_screening,
        "publicLicenseScreeningShortfall": max(0, net_new_required - public_screening),
        "agreementCandidateLowerBound": agreement_lower_bound,
        "firstMilestone": {
            "targetNativePapers": milestone["targetNativePapers"],
            "screeningCandidates": screening,
            "netNewRequired": milestone_required,
            "requiredPassRate": round(milestone_required / screening, 4),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portfolio", type=Path, required=True)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if not args.validate:
        parser.error("Choose --validate.")
    try:
        portfolio = load_portfolio(args.portfolio.resolve())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"portfolio validation failed: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2) from exc
    print(json.dumps(portfolio_summary(portfolio), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
