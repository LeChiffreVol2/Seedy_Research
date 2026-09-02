#!/usr/bin/env python3
"""Run a dated Thai-provider visibility audit against OpenAlex.

Dry-run is the default and performs no network or database writes. ``--apply``
reads one bounded provider cohort from Supabase, resolves exact DOI matches in
batches, optionally searches remaining titles, and upserts replayable receipts.
Provider failures are stored as ``audit_unavailable`` and never counted as
``not_found_in_audit``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable


METHOD_VERSION = "seedy-openalex-visibility-v2-singleton-doi"
OPENALEX_URL = "https://api.openalex.org/works"
OPENALEX_SELECT = (
    "id,doi,display_name,publication_year,abstract_inverted_index,authorships,"
    "referenced_works,open_access,best_oa_location"
)
DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$", re.IGNORECASE)
THAI_RE = re.compile(r"[\u0E00-\u0E7F]")
TITLE_STOPWORDS = {
    "a", "an", "and", "associated", "for", "in", "of", "on", "or", "study", "the", "with",
    "การ", "ของ", "จาก", "ด้วย", "ที่", "และ", "ใน", "เป็น", "เพื่อ", "ศึกษา", "งานวิจัย", "วิจัย",
}
CATALOG_SELECT = (
    "id,provider,provider_record_id,work_id,title_local,title_en,abstract_local,abstract_en,"
    "authors,doi,pdf_url,published_at,access_level,raw_metadata"
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_doi(value: Any) -> str | None:
    cleaned = str(value or "").strip().lower()
    cleaned = re.sub(r"^doi:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", cleaned, flags=re.IGNORECASE)
    return cleaned if DOI_RE.match(cleaned) else None


def normalized_text(value: Any, limit: int = 500) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def normalized_title(value: Any) -> str:
    text = normalized_text(value, 500).casefold()
    text = re.sub(r"[^\w\u0E00-\u0E7F]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def title_tokens(value: Any) -> set[str]:
    return {token for token in normalized_title(value).split() if token and token not in TITLE_STOPWORDS}


def title_similarity(left: Any, right: Any) -> float:
    left_title = normalized_title(left)
    right_title = normalized_title(right)
    if not left_title or not right_title:
        return 0.0
    if left_title == right_title:
        return 1.0
    left_tokens = title_tokens(left)
    right_tokens = title_tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def author_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for item in value:
        if isinstance(item, str):
            name = item
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("display_name") or item.get("full_name") or "")
        else:
            continue
        normalized = normalized_text(name, 160)
        if normalized:
            names.append(normalized)
    return names[:50]


def openalex_author_names(work: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for authorship in work.get("authorships") or []:
        if not isinstance(authorship, dict):
            continue
        author = authorship.get("author") or {}
        if isinstance(author, dict):
            name = normalized_text(author.get("display_name"), 160)
            if name:
                names.append(name)
    return names


def author_overlap(local: list[str], external: list[str]) -> float:
    def keys(names: list[str]) -> set[str]:
        result: set[str] = set()
        for name in names:
            tokens = normalized_title(name).split()
            if tokens:
                result.add(tokens[-1])
        return result

    left = keys(local)
    right = keys(external)
    return len(left & right) / max(1, len(left)) if left and right else 0.0


def publication_year(record: dict[str, Any]) -> int | None:
    match = re.search(r"\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b", str(record.get("published_at") or ""))
    return int(match.group(1)) if match else None


def metadata_gaps(record: dict[str, Any], work: dict[str, Any]) -> list[str]:
    gaps: list[str] = []
    local_title = normalized_text(record.get("title_local"), 500)
    external_title = normalized_text(work.get("display_name"), 500)
    if THAI_RE.search(local_title) and not THAI_RE.search(external_title):
        gaps.append("thai_title_not_represented")
    if (record.get("abstract_local") or record.get("abstract_en")) and not work.get("abstract_inverted_index"):
        gaps.append("abstract_missing")
    if author_names(record.get("authors")) and not openalex_author_names(work):
        gaps.append("authors_missing")
    raw_metadata = record.get("raw_metadata") if isinstance(record.get("raw_metadata"), dict) else {}
    local_references = raw_metadata.get("references") or raw_metadata.get("relation") or raw_metadata.get("relations")
    if local_references and not work.get("referenced_works"):
        gaps.append("references_missing")
    open_access = work.get("open_access") if isinstance(work.get("open_access"), dict) else {}
    best_location = work.get("best_oa_location") if isinstance(work.get("best_oa_location"), dict) else {}
    if (record.get("pdf_url") or str(record.get("access_level") or "").startswith("full_text")) and not (
        open_access.get("oa_url") or best_location.get("landing_page_url") or best_location.get("pdf_url")
    ):
        gaps.append("open_fulltext_location_missing")
    return gaps


def query_fingerprint(record: dict[str, Any]) -> str:
    payload = {
        "provider": record.get("provider"),
        "provider_record_id": record.get("provider_record_id"),
        "doi": normalize_doi(record.get("doi")),
        "title_local": normalized_title(record.get("title_local")),
        "title_en": normalized_title(record.get("title_en")),
        "year": publication_year(record),
        "authors": sorted(normalized_title(name) for name in author_names(record.get("authors"))),
        "method_version": METHOD_VERSION,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def external_url(work: dict[str, Any]) -> str | None:
    identifier = normalized_text(work.get("id"), 320)
    if identifier.startswith("https://openalex.org/"):
        return identifier
    if re.fullmatch(r"W\d+", identifier, flags=re.IGNORECASE):
        return f"https://openalex.org/{identifier.upper()}"
    return None


def candidate_snapshot(work: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": normalized_text(work.get("id"), 320) or None,
        "doi": normalize_doi(work.get("doi")),
        "title": normalized_text(work.get("display_name"), 500) or None,
        "year": work.get("publication_year") if isinstance(work.get("publication_year"), int) else None,
        "authors": openalex_author_names(work)[:5],
    }


def base_result(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_catalog_id": record["id"],
        "work_id": record.get("work_id"),
        "provider": record["provider"],
        "external_index": "openalex",
        "external_work_id": None,
        "external_doi": None,
        "external_title": None,
        "external_year": None,
        "external_url": None,
        "confidence": None,
        "title_similarity": None,
        "year_delta": None,
        "requires_human_review": False,
        "metadata_gaps": [],
        "candidate_snapshot": {},
        "query_fingerprint": query_fingerprint(record),
        "provider_error_code": None,
        "provider_error_detail": None,
        "checked_at": utc_now(),
    }


def classify_lookup(record: dict[str, Any], lookup: dict[str, Any]) -> dict[str, Any]:
    result = base_result(record)
    if lookup.get("status") != "connected":
        result.update({
            "visibility_state": "audit_unavailable",
            "match_basis": "provider_unavailable",
            "provider_error_code": normalized_text(lookup.get("error_code") or lookup.get("status"), 80) or "provider_unavailable",
            "provider_error_detail": normalized_text(lookup.get("error_detail"), 500) or None,
        })
        return result

    candidates = [item for item in lookup.get("candidates") or [] if isinstance(item, dict)]
    expected_doi = normalize_doi(record.get("doi"))
    exact = next((work for work in candidates if expected_doi and normalize_doi(work.get("doi")) == expected_doi), None)
    if exact:
        gaps = metadata_gaps(record, exact)
        result.update({
            "visibility_state": "under_indexed" if gaps else "globally_indexed",
            "match_basis": "exact_doi",
            "external_work_id": normalized_text(exact.get("id"), 320) or None,
            "external_doi": normalize_doi(exact.get("doi")),
            "external_title": normalized_text(exact.get("display_name"), 500) or None,
            "external_year": exact.get("publication_year") if isinstance(exact.get("publication_year"), int) else None,
            "external_url": external_url(exact),
            "confidence": 1.0,
            "title_similarity": title_similarity(record.get("title_en") or record.get("title_local"), exact.get("display_name")),
            "year_delta": abs(publication_year(record) - exact["publication_year"]) if publication_year(record) and isinstance(exact.get("publication_year"), int) else None,
            "metadata_gaps": gaps,
            "candidate_snapshot": candidate_snapshot(exact),
        })
        return result

    local_title = record.get("title_en") or record.get("title_local")
    local_year = publication_year(record)
    local_authors = author_names(record.get("authors"))
    ranked: list[tuple[float, float, int, dict[str, Any]]] = []
    for work in candidates:
        similarity = title_similarity(local_title, work.get("display_name"))
        overlap = author_overlap(local_authors, openalex_author_names(work))
        candidate_year = work.get("publication_year") if isinstance(work.get("publication_year"), int) else None
        delta = abs(local_year - candidate_year) if local_year and candidate_year else 99
        ranked.append((similarity, overlap, delta, work))
    ranked.sort(key=lambda item: (-item[0], -item[1], item[2], normalized_text(item[3].get("id"))))
    if ranked:
        similarity, overlap, delta, work = ranked[0]
        exact_title = normalized_title(local_title) == normalized_title(work.get("display_name"))
        acceptable_year = local_year is None or delta <= 1
        if exact_title and acceptable_year:
            basis = "title_author_year" if overlap > 0 else "exact_title_year"
            confidence = min(0.99, 0.88 + (0.08 if overlap > 0 else 0.0) + (0.03 if delta == 0 else 0.0))
        elif similarity >= 0.78 and acceptable_year and (overlap >= 0.5 or not local_authors):
            basis = "fuzzy_title"
            confidence = min(0.95, 0.58 * similarity + 0.27 * overlap + (0.1 if delta == 0 else 0.05))
        else:
            basis = ""
            confidence = 0.0
        if basis:
            result.update({
                "visibility_state": "candidate_match",
                "match_basis": basis,
                "external_work_id": normalized_text(work.get("id"), 320) or None,
                "external_doi": normalize_doi(work.get("doi")),
                "external_title": normalized_text(work.get("display_name"), 500) or None,
                "external_year": work.get("publication_year") if isinstance(work.get("publication_year"), int) else None,
                "external_url": external_url(work),
                "confidence": round(confidence, 5),
                "title_similarity": round(similarity, 5),
                "year_delta": None if delta == 99 else delta,
                "requires_human_review": True,
                "candidate_snapshot": candidate_snapshot(work),
            })
            return result

    result.update({"visibility_state": "not_found_in_audit", "match_basis": "none"})
    return result


def audit_key(provider: str, external_index: str, snapshot_date: str, strategy: str) -> str:
    return f"{provider}:{external_index}:{snapshot_date}:{strategy}:{METHOD_VERSION}"


def chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


@dataclass
class OpenAlexClient:
    api_key: str
    mailto: str
    requests_per_second: float = 5.0
    timeout_seconds: int = 20

    def __post_init__(self) -> None:
        self._last_request = 0.0

    def _fetch(self, params: dict[str, str], endpoint: str = OPENALEX_URL) -> dict[str, Any]:
        if self.api_key:
            params["api_key"] = self.api_key
        if self.mailto:
            params["mailto"] = self.mailto
        query = urllib.parse.urlencode(params)
        url = f"{endpoint}?{query}" if query else endpoint
        for attempt in range(3):
            interval = 1 / max(0.2, min(self.requests_per_second, 10.0))
            wait = interval - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "SeedyResearchVisibilityAudit/1.0"})
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    return {"status": "connected", "payload": json.load(response)}
            except urllib.error.HTTPError as error:
                if error.code == 429 or error.code >= 500:
                    if attempt < 2:
                        time.sleep(2 ** attempt)
                        continue
                return {"status": "rate_limited" if error.code == 429 else "unavailable", "error_code": f"http_{error.code}", "error_detail": str(error)}
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return {"status": "unavailable", "error_code": type(error).__name__.lower(), "error_detail": str(error)}
        return {"status": "unavailable", "error_code": "retry_exhausted"}

    def lookup_doi_batch(self, records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        doi_records = {normalize_doi(record.get("doi")): record for record in records if normalize_doi(record.get("doi"))}
        if not doi_records:
            return {}
        # OpenAlex documents DOI OR filters, but some Thai DOI families resolve
        # through the singleton endpoint while being absent from the filter
        # index. Singleton identity lookups are free and avoid false not-found
        # receipts, so correctness takes precedence over fewer HTTP requests.
        lookups: dict[str, dict[str, Any]] = {}
        for doi in doi_records:
            identifier = urllib.parse.quote(f"https://doi.org/{doi}", safe=":/")
            response = self._fetch(
                {"select": OPENALEX_SELECT},
                endpoint=f"{OPENALEX_URL}/{identifier}",
            )
            if response.get("status") != "connected":
                error_code = response.get("error_code")
                if error_code == "http_404":
                    lookups[doi] = {"status": "connected", "candidates": []}
                else:
                    lookups[doi] = {**response, "candidates": []}
                continue
            work = response.get("payload")
            lookups[doi] = {"status": "connected", "candidates": [work] if isinstance(work, dict) else []}
        return lookups

    def lookup_title(self, record: dict[str, Any]) -> dict[str, Any]:
        title = normalized_text(record.get("title_en") or record.get("title_local"), 500)
        if not title:
            return {"status": "connected", "candidates": []}
        response = self._fetch({"search": title, "per_page": "5", "select": OPENALEX_SELECT})
        if response.get("status") != "connected":
            return {**response, "candidates": []}
        return {"status": "connected", "candidates": [work for work in response.get("payload", {}).get("results", []) if isinstance(work, dict)]}


def git_commit() -> str | None:
    value = os.getenv("GITHUB_SHA", "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{7,64}", value):
        return value
    try:
        value = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, timeout=3).strip().lower()
        return value if re.fullmatch(r"[0-9a-f]{7,64}", value) else None
    except (OSError, subprocess.SubprocessError):
        return None


def fetch_catalog(client: Any, provider: str, max_records: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_size = 500
    offset = 0
    while True:
        query = (
            client.table("civil_source_catalog")
            .select(CATALOG_SELECT)
            .eq("provider", provider)
            .neq("evidence_status", "removed")
            .order("id")
            .range(offset, offset + page_size - 1)
        )
        batch = list(query.execute().data or [])
        rows.extend(batch)
        if len(batch) < page_size or (max_records and len(rows) >= max_records):
            break
        offset += page_size
    return rows[:max_records] if max_records else rows


def existing_source_ids(client: Any, run_id: str) -> set[str]:
    result: set[str] = set()
    offset = 0
    while True:
        batch = list(
            client.table("civil_external_index_matches")
            .select("source_catalog_id,visibility_state")
            .eq("audit_run_id", run_id)
            .order("source_catalog_id")
            .range(offset, offset + 999)
            .execute().data or []
        )
        result.update(
            str(row["source_catalog_id"])
            for row in batch
            if row.get("visibility_state") != "audit_unavailable"
        )
        if len(batch) < 1000:
            return result
        offset += 1000


def run_apply(args: argparse.Namespace) -> dict[str, Any]:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ModuleNotFoundError:
        pass
    from supabase import create_client

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    api_key = os.getenv("OPENALEX_API_KEY", "").strip()
    mailto = os.getenv("OPENALEX_MAILTO", "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --apply.")
    if not api_key and not args.allow_anonymous:
        raise RuntimeError("OPENALEX_API_KEY is required unless --allow-anonymous is explicit.")

    database = create_client(supabase_url, service_key)
    cohort = fetch_catalog(database, args.provider, 0)
    denominator = len(cohort)
    records = cohort[:args.max_records] if args.max_records else cohort
    snapshot_date = args.snapshot_date or dt.date.today().isoformat()
    key = audit_key(args.provider, "openalex", snapshot_date, args.strategy)
    config = {
        "provider": args.provider,
        "external_index": "openalex",
        "snapshot_date": snapshot_date,
        "strategy": args.strategy,
        "denominator": denominator,
        "max_records": args.max_records,
        "requests_per_second": args.requests_per_second,
        "method_version": METHOD_VERSION,
    }
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()
    run_row = {
        "audit_key": key,
        "provider": args.provider,
        "external_index": "openalex",
        "audit_snapshot_date": snapshot_date,
        "strategy": args.strategy,
        "run_status": "running",
        "method_version": METHOD_VERSION,
        "config_hash": config_hash,
        "code_commit": git_commit(),
        "cohort_filter": {
            "provider": args.provider,
            "evidence_status": "not_removed",
            "bounded_records_this_invocation": len(records),
        },
        "denominator": denominator,
        "started_at": utc_now(),
        "completed_at": None,
        "error_summary": None,
        "updated_at": utc_now(),
    }
    response = database.table("civil_visibility_audit_runs").upsert(run_row, on_conflict="audit_key").execute()
    persisted = list(response.data or [])
    if not persisted:
        persisted = list(database.table("civil_visibility_audit_runs").select("audit_run_id").eq("audit_key", key).limit(1).execute().data or [])
    if not persisted:
        raise RuntimeError("Visibility audit run could not be created or resumed.")
    run_id = str(persisted[0]["audit_run_id"])
    processed = existing_source_ids(database, run_id)
    pending = [record for record in records if str(record["id"]) not in processed]
    if args.strategy == "identifiers":
        pending = [record for record in pending if normalize_doi(record.get("doi"))]

    openalex = OpenAlexClient(api_key=api_key, mailto=mailto, requests_per_second=args.requests_per_second)
    written = 0
    for record_batch in chunks(pending, args.batch_size):
        doi_records = [record for record in record_batch if normalize_doi(record.get("doi"))]
        title_records = [record for record in record_batch if not normalize_doi(record.get("doi"))]
        doi_lookups: dict[str, dict[str, Any]] = {}
        for doi_batch in chunks(doi_records, 50):
            doi_lookups.update(openalex.lookup_doi_batch(doi_batch))
        results: list[dict[str, Any]] = []
        for record in doi_records:
            doi = normalize_doi(record.get("doi"))
            results.append(classify_lookup(record, doi_lookups.get(doi or "", {"status": "connected", "candidates": []})))
        if args.strategy == "full":
            for record in title_records:
                results.append(classify_lookup(record, openalex.lookup_title(record)))
        for result in results:
            result["audit_run_id"] = run_id
        if results:
            database.table("civil_external_index_matches").upsert(
                results, on_conflict="audit_run_id,source_catalog_id"
            ).execute()
            written += len(results)
            database.table("civil_visibility_audit_runs").update({
                "resume_after_id": max(result["source_catalog_id"] for result in results),
                "updated_at": utc_now(),
            }).eq("audit_run_id", run_id).execute()

    attempted = len(existing_source_ids(database, run_id))
    complete = args.strategy == "full" and attempted == denominator
    database.table("civil_visibility_audit_runs").update({
        "run_status": "complete" if complete else "partial",
        "completed_at": utc_now(),
        "updated_at": utc_now(),
    }).eq("audit_run_id", run_id).execute()
    return {
        "auditRunId": run_id,
        "auditKey": key,
        "provider": args.provider,
        "strategy": args.strategy,
        "denominator": denominator,
        "previouslyProcessed": len(processed),
        "written": written,
        "attempted": attempted,
        "status": "complete" if complete else "partial",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Run OpenAlex requests and persist receipts. Dry-run is the default.")
    parser.add_argument("--provider", default="tci_thaijo")
    parser.add_argument("--strategy", choices=("identifiers", "full"), default="identifiers")
    parser.add_argument("--snapshot-date", default="")
    parser.add_argument("--max-records", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--requests-per-second", type=float, default=5.0)
    parser.add_argument("--allow-anonymous", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9_:-]{1,64}", args.provider):
        parser.error("--provider is invalid")
    if args.snapshot_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.snapshot_date):
        parser.error("--snapshot-date must use YYYY-MM-DD")
    if args.max_records < 0:
        parser.error("--max-records must be non-negative")
    if not 1 <= args.batch_size <= 200:
        parser.error("--batch-size must be between 1 and 200")
    if not 0.2 <= args.requests_per_second <= 10:
        parser.error("--requests-per-second must be between 0.2 and 10")
    return args


def main() -> int:
    args = parse_args()
    if not args.apply:
        print(json.dumps({
            "mode": "dry_run",
            "provider": args.provider,
            "externalIndex": "openalex",
            "strategy": args.strategy,
            "methodVersion": METHOD_VERSION,
            "writes": 0,
            "note": "Use --apply with server-only Supabase and OpenAlex credentials.",
        }, indent=2))
        return 0
    print(json.dumps(run_apply(args), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
