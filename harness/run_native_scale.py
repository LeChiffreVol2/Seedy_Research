from __future__ import annotations

import argparse
import base64
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import median
from typing import Any
from urllib.parse import quote

from common import Check, http_json, load_env, make_report, print_report, write_report


def choose_cursor_offset(*, target_native_papers: int, catalog_total: int, page_size: int) -> int:
    """Choose a deep full page, reaching the target paper once data exists."""
    if target_native_papers < 1 or catalog_total < 0 or page_size < 1:
        raise ValueError("Scale cursor inputs must be positive, with a non-negative catalog total.")
    target_offset = max(0, target_native_papers - 10)
    deepest_full_page = max(0, catalog_total - page_size)
    return min(target_offset, deepest_full_page)


def capacity_projection(
    *,
    target_native_papers: int,
    observed_native_papers: int,
    observed_pages: int,
) -> dict[str, int]:
    if target_native_papers < 1 or observed_native_papers < 1 or observed_pages < 1:
        raise ValueError("Capacity projection inputs must be positive.")
    return {
        "targetNativePapers": target_native_papers,
        "projectedPagesAtCurrentMean": round(
            target_native_papers * observed_pages / observed_native_papers
        ),
    }


def percentile(values: list[float], percentile_value: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, math.ceil(percentile_value * len(ordered)) - 1)
    return ordered[index]


def encoded_cursor(offset: int) -> str:
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def load_once(url: str) -> tuple[int, Any, float]:
    return http_json("GET", url, timeout=45)


def exercise_endpoint(
    name: str,
    url: str,
    *,
    requests: int,
    concurrency: int,
    validator: Any,
) -> Check:
    samples: list[tuple[int, Any, float]] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(load_once, f"{url}&scale_probe={index}") for index in range(requests)]
        for future in as_completed(futures):
            samples.append(future.result())

    invalid = [
        {"status": status, "payload": payload}
        for status, payload, _latency in samples
        if status != 200 or not validator(payload)
    ]
    latencies = [latency for _status, _payload, latency in samples]
    p95 = percentile(latencies, 0.95)
    ok = not invalid and len(samples) == requests and p95 <= 5_000
    return Check(
        name,
        "pass" if ok else "fail",
        (
            f"requests={len(samples)}; errors={len(invalid)}; concurrency={concurrency}; "
            f"median={median(latencies):.1f}ms; p95={p95:.1f}ms"
        ),
        "Inspect Vercel function and Supabase query latency before expanding the native cohort." if not ok else "",
        p95,
        {
            "requests": len(samples),
            "errors": len(invalid),
            "concurrency": concurrency,
            "medianMs": round(median(latencies), 2),
            "p95Ms": round(p95, 2),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bounded production smoke for a 5,000-paper native-reader catalog."
    )
    parser.add_argument("--web-url", default="", help="Web origin; defaults to WEB_URL or production.")
    parser.add_argument("--requests", type=int, default=24, help="Requests per endpoint (1-100).")
    parser.add_argument("--concurrency", type=int, default=6, help="Concurrent workers (1-12).")
    parser.add_argument("--provider", default="pmc_oa", help="Native provider exercised by the live probe.")
    parser.add_argument("--target-native-papers", type=int, default=5_000, help="Native-paper capacity target.")
    parser.add_argument("--observed-pages", type=int, default=14_485, help="Verified pages in the current production native corpus.")
    parser.add_argument("--cursor-offset", type=int, help="Override the deepest full catalog page exercised.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when a scale check fails.")
    args = parser.parse_args()
    if not 1 <= args.requests <= 100 or not 1 <= args.concurrency <= 12:
        parser.error("--requests must be 1-100 and --concurrency must be 1-12")
    if not 1 <= args.target_native_papers <= 10_010:
        parser.error("--target-native-papers must be 1-10010")
    if args.cursor_offset is not None and not 0 <= args.cursor_offset <= 10_000:
        parser.error("--cursor-offset must be 0-10000")
    if args.observed_pages < 1:
        parser.error("--observed-pages must be positive")

    env = load_env()
    web_url = (args.web_url or env.get("WEB_URL") or "https://seedresearch.vercel.app").rstrip("/")
    bootstrap_url = f"{web_url}/api/research-feed?filter=thai&provider={quote(args.provider, safe='')}&limit=30"
    status, bootstrap, bootstrap_latency = load_once(bootstrap_url)
    cards = bootstrap.get("cards", []) if isinstance(bootstrap, dict) else []
    facets = bootstrap.get("facets", {}) if isinstance(bootstrap, dict) else {}
    provider_facets = facets.get("providers", []) if isinstance(facets, dict) else []
    provider_total = next(
        (
            int(row.get("records", 0))
            for row in provider_facets
            if isinstance(row, dict) and row.get("provider") == args.provider
        ),
        int(facets.get("catalogTotal", 0)) if isinstance(facets, dict) else 0,
    )
    cursor_offset = args.cursor_offset if args.cursor_offset is not None else choose_cursor_offset(
        target_native_papers=args.target_native_papers,
        catalog_total=provider_total,
        page_size=30,
    )
    native = next(
        (
            card for card in cards
            if isinstance(card, dict)
            and card.get("citable") is True
            and card.get("accessLevel") in ("full_text_local", "full_text_licensed")
        ),
        None,
    )
    bootstrap_ok = status == 200 and isinstance(native, dict) and bool(native.get("source"))
    coverage = facets.get("coverage", []) if isinstance(facets, dict) else []
    observed_native_papers = sum(
        int(row.get("nativeFullPaper", 0))
        for row in coverage
        if isinstance(row, dict)
    )
    checks = [
        Check(
            "native_scale_bootstrap",
            "pass" if bootstrap_ok else "fail",
            f"HTTP {status}; cards={len(cards)}; nativeSource={native.get('source') if isinstance(native, dict) else None}",
            "Deploy at least one rights-verified native paper and keep it first in Thai discovery." if not bootstrap_ok else "",
            bootstrap_latency,
        )
    ]

    if bootstrap_ok:
        feed_url = (
            f"{bootstrap_url}&cursor={quote(encoded_cursor(cursor_offset), safe='')}"
        )
        reader_url = (
            f"{web_url}/api/papers/{quote(str(native['source']), safe='')}/reader?provider={quote(args.provider, safe='')}&page=1&limit=10"
        )
        checks.append(exercise_endpoint(
            "native_scale_deep_feed",
            feed_url,
            requests=args.requests,
            concurrency=args.concurrency,
            validator=lambda payload: (
                isinstance(payload, dict)
                and isinstance(payload.get("cards"), list)
                and len(payload["cards"]) == 30
            ),
        ))
        checks.append(exercise_endpoint(
            "native_scale_reader",
            reader_url,
            requests=args.requests,
            concurrency=args.concurrency,
            validator=lambda payload: (
                isinstance(payload, dict)
                and isinstance(payload.get("pages"), list)
                and 1 <= len(payload["pages"]) <= 10
                and isinstance(payload.get("access"), dict)
                and payload["access"].get("mode") == "native_verified"
            ),
        ))

    projection = capacity_projection(
        target_native_papers=args.target_native_papers,
        observed_native_papers=observed_native_papers,
        observed_pages=args.observed_pages,
    )
    report = make_report(
        "native_scale",
        checks,
        {
            **projection,
            "providerExercised": args.provider,
            "observedNativePapers": observed_native_papers,
            "observedPages": args.observed_pages,
            "targetCursorOffset": max(0, args.target_native_papers - 10),
            "exercisedCursorOffset": cursor_offset,
            "targetCursorExercised": cursor_offset >= max(0, args.target_native_papers - 10),
            "catalogRecordsObserved": provider_total,
            "requestsPerEndpoint": args.requests,
            "concurrency": args.concurrency,
        },
    )
    path = write_report("native_scale", report)
    print_report(report, path)
    if args.strict and report["status"] != "pass":
        sys.exit(1)


if __name__ == "__main__":
    main()
