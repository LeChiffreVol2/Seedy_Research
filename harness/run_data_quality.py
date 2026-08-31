from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

from common import ROOT, Check, load_env, make_report, print_report, write_report

sys.path.insert(0, str(ROOT / "pipeline"))
from evidence_exclusions import (  # noqa: E402
    DEFAULT_EVIDENCE_EXCLUSIONS_PATH,
    EvidenceExclusionError,
    ReviewedEvidenceExclusion,
    load_evidence_exclusion_manifest,
    select_index_sources,
)

try:
    from metadata import infer_discipline_from_code, prefix_from_code
    from text_quality import ocr_quality_metrics
except Exception:  # pragma: no cover
    infer_discipline_from_code = None
    prefix_from_code = None
    ocr_quality_metrics = None

MD_DIR = ROOT / "pipeline" / "data" / "markdown"
TITLE_OVERRIDES_PATH = ROOT / "web" / "lib" / "paper-title-overrides.json"
EVIDENCE_EXCLUSIONS_PATH = DEFAULT_EVIDENCE_EXCLUSIONS_PATH
PAGE_MARKER_RE = re.compile(r"^#{1,6}\s+Page\s+(\d+)\s*$", re.M | re.I)
MAX_PAGE_MARKER_GAP = 2
DUPLICATE_BODY_SIMILARITY_MIN = 0.98
MIN_DUPLICATE_BODY_CHARS = 1000
MAX_INTEGRITY_OFFENDER_SAMPLES = 10
REVIEWED_SIMILARITY_TOLERANCE = 0.002


def load_title_overrides() -> dict[str, str]:
    if not TITLE_OVERRIDES_PATH.exists():
        return {}
    try:
        payload = json.loads(TITLE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return {str(key): str(value).strip() for key, value in payload.items()} if isinstance(payload, dict) else {}


def is_weak_title(value: str) -> bool:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return (
        len(cleaned) < 8
        or bool(re.match(r"^(Y\d{4}|NCCE\d{2})[_-]", cleaned, re.I))
        or bool(re.match(r"^2101499(?:\s|โครงงาน)", cleaned, re.I))
        or bool(re.match(r"^find\s+the\s+result\s+that\s+minimizes", cleaned, re.I))
    )


def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end].strip()
    body = text[end + len("\n---") :]
    meta: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    return meta, body


def effective_title_for_document(path: Path, body: str, title_overrides: dict[str, str]) -> str:
    first_heading = re.search(r"^#\s+(.+)$", body, re.M)
    return title_overrides.get(path.name) or (first_heading.group(1).strip() if first_heading else "")


def normalize_title_for_duplicate_check(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)


def normalize_body_for_duplicate_check(body: str) -> str:
    without_title = re.sub(r"^#\s+.+$", "", body, count=1, flags=re.M)
    without_markers = PAGE_MARKER_RE.sub("", without_title)
    normalized = unicodedata.normalize("NFKC", without_markers).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def page_boundary_violations(path: Path, meta: dict[str, str], body: str) -> list[dict[str, Any]]:
    pages = [int(value) for value in PAGE_MARKER_RE.findall(body)]
    if not pages:
        return []

    violations: list[dict[str, Any]] = []
    non_increasing = next(
        ((left, right) for left, right in zip(pages, pages[1:]) if right <= left),
        None,
    )
    if non_increasing:
        violations.append(
            {
                "file": path.name,
                "kind": "non_increasing_page_markers",
                "from": non_increasing[0],
                "to": non_increasing[1],
            }
        )

    severe_gap = next(
        ((left, right) for left, right in zip(pages, pages[1:]) if right - left > MAX_PAGE_MARKER_GAP),
        None,
    )
    if severe_gap:
        violations.append(
            {
                "file": path.name,
                "kind": "page_marker_gap",
                "from": severe_gap[0],
                "to": severe_gap[1],
                "gap": severe_gap[1] - severe_gap[0],
                "maxAllowed": MAX_PAGE_MARKER_GAP,
            }
        )

    declared_values = (meta.get("page_start", "").strip(), meta.get("page_end", "").strip())
    if any(declared_values):
        try:
            declared_start, declared_end = (int(value) for value in declared_values)
        except ValueError:
            violations.append(
                {
                    "file": path.name,
                    "kind": "invalid_declared_page_range",
                    "declared": list(declared_values),
                }
            )
        else:
            marker_range = [min(pages), max(pages)]
            if [declared_start, declared_end] != marker_range:
                violations.append(
                    {
                        "file": path.name,
                        "kind": "declared_page_range_mismatch",
                        "declared": [declared_start, declared_end],
                        "markers": marker_range,
                    }
                )
    return violations


def probable_duplicate_pairs(
    documents_by_title: dict[str, list[tuple[str, str]]],
) -> list[dict[str, Any]]:
    offenders: list[dict[str, Any]] = []
    for documents in documents_by_title.values():
        if len(documents) < 2:
            continue
        for (left_name, left_body), (right_name, right_body) in combinations(documents, 2):
            if min(len(left_body), len(right_body)) < MIN_DUPLICATE_BODY_CHARS:
                continue
            similarity = difflib.SequenceMatcher(None, left_body, right_body).ratio()
            if similarity >= DUPLICATE_BODY_SIMILARITY_MIN:
                offenders.append(
                    {
                        "files": sorted([left_name, right_name]),
                        "bodySimilarity": round(similarity, 4),
                    }
                )
    return sorted(offenders, key=lambda item: (-item["bodySimilarity"], item["files"]))


def classify_probable_duplicate_pairs(
    duplicate_pairs: list[dict[str, Any]],
    reviewed_exclusions: tuple[ReviewedEvidenceExclusion, ...],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    exclusions_by_source = {item.source: item for item in reviewed_exclusions}
    reviewed: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for pair in duplicate_pairs:
        files = pair["files"]
        matching = [exclusions_by_source[name] for name in files if name in exclusions_by_source]
        exclusion = matching[0] if len(matching) == 1 else None
        other_source = next((name for name in files if exclusion and name != exclusion.source), None)
        observed_similarity = float(pair["bodySimilarity"])
        if (
            exclusion
            and other_source == exclusion.canonical_source
            and abs(observed_similarity - exclusion.body_similarity)
            <= REVIEWED_SIMILARITY_TOLERANCE
        ):
            reviewed.append(
                {
                    **pair,
                    "excludedSource": exclusion.source,
                    "canonicalSource": exclusion.canonical_source,
                    "manifestBodySimilarity": exclusion.body_similarity,
                    "reviewedAt": exclusion.reviewed_at,
                }
            )
        else:
            unresolved.append(pair)
    return reviewed, unresolved


def markdown_integrity_check() -> Check:
    files = sorted(MD_DIR.glob("*.md"))
    if not files:
        return Check("markdown_corpus_integrity", "fail", f"No markdown files in {MD_DIR}", "Run extraction first.")

    manifest_version: int | None = None
    manifest_error = ""
    reviewed_exclusions: tuple[ReviewedEvidenceExclusion, ...] = ()
    index_eligible_files = files
    try:
        manifest = load_evidence_exclusion_manifest(EVIDENCE_EXCLUSIONS_PATH)
        selection = select_index_sources(files, (), manifest)
        manifest_version = manifest.version
        reviewed_exclusions = selection.reviewed_exclusions
        index_eligible_files = list(selection.eligible_files)
    except EvidenceExclusionError as exc:
        manifest_error = str(exc)

    title_overrides = load_title_overrides()
    boundary_violations: list[dict[str, Any]] = []
    documents_by_title: dict[str, list[tuple[str, str]]] = defaultdict(list)
    files_with_page_markers = 0
    index_eligible_names = {path.name for path in index_eligible_files}

    for path in files:
        meta, body = parse_frontmatter(path)
        pages = PAGE_MARKER_RE.findall(body)
        if pages:
            files_with_page_markers += 1
        if path.name in index_eligible_names:
            boundary_violations.extend(page_boundary_violations(path, meta, body))

        title = effective_title_for_document(path, body, title_overrides)
        normalized_title = normalize_title_for_duplicate_check(title)
        if normalized_title:
            documents_by_title[normalized_title].append(
                (path.name, normalize_body_for_duplicate_check(body))
            )

    duplicate_pairs = probable_duplicate_pairs(documents_by_title)
    reviewed_duplicate_pairs, unresolved_duplicate_pairs = classify_probable_duplicate_pairs(
        duplicate_pairs,
        reviewed_exclusions,
    )
    status = "fail" if boundary_violations or unresolved_duplicate_pairs or manifest_error else "pass"
    remediation = ""
    if status == "fail":
        remediation = (
            "Re-extract boundary offenders and quarantine confirmed duplicates in an index-enforced workflow; "
            "do not suppress them with a QA-only allowlist."
        )
    return Check(
        "markdown_corpus_integrity",
        status,
        json.dumps(
            {
                "files": len(files),
                "totalFiles": len(files),
                "indexEligibleFiles": len(index_eligible_files),
                "filesWithPageMarkers": files_with_page_markers,
                "exclusionManifestVersion": manifest_version,
                "exclusionManifestError": manifest_error or None,
                "reviewedExclusionCount": len(reviewed_exclusions),
                "reviewedExclusions": [item.summary() for item in reviewed_exclusions],
                "pageBoundaryViolationCount": len(boundary_violations),
                "pageBoundaryOffenders": boundary_violations[:MAX_INTEGRITY_OFFENDER_SAMPLES],
                "probableDuplicatePairCount": len(duplicate_pairs),
                "probableDuplicatePairs": duplicate_pairs[:MAX_INTEGRITY_OFFENDER_SAMPLES],
                "reviewedDuplicatePairCount": len(reviewed_duplicate_pairs),
                "reviewedDuplicatePairs": reviewed_duplicate_pairs[:MAX_INTEGRITY_OFFENDER_SAMPLES],
                "unresolvedProbableDuplicatePairCount": len(unresolved_duplicate_pairs),
                "unresolvedProbableDuplicatePairs": unresolved_duplicate_pairs[
                    :MAX_INTEGRITY_OFFENDER_SAMPLES
                ],
                "thresholds": {
                    "maxPageMarkerGap": MAX_PAGE_MARKER_GAP,
                    "duplicateBodySimilarityMin": DUPLICATE_BODY_SIMILARITY_MIN,
                    "minDuplicateBodyChars": MIN_DUPLICATE_BODY_CHARS,
                },
            },
            ensure_ascii=False,
        ),
        remediation,
        metrics={
            "fileCount": len(files),
            "totalFileCount": len(files),
            "indexEligibleFileCount": len(index_eligible_files),
            "reviewedExclusionCount": len(reviewed_exclusions),
            "filesWithPageMarkers": files_with_page_markers,
            "pageBoundaryViolationCount": len(boundary_violations),
            "probableDuplicatePairCount": len(duplicate_pairs),
            "reviewedDuplicatePairCount": len(reviewed_duplicate_pairs),
            "unresolvedProbableDuplicatePairCount": len(unresolved_duplicate_pairs),
        },
    )


def markdown_quality_check() -> Check:
    files = sorted(MD_DIR.glob("*.md"))
    if not files:
        return Check("markdown_corpus_quality", "fail", f"No markdown files in {MD_DIR}", "Run extraction first.")

    by_collection = Counter()
    unknown_prefixes = Counter()
    missing_page = 0
    replacement_rates: list[tuple[str, float]] = []
    weak_titles = 0
    title_overrides = load_title_overrides()

    for path in files:
        meta, body = parse_frontmatter(path)
        collection = meta.get("collection") or ("ncce" if path.name.startswith("NCCE") else "ce_project")
        by_collection[collection] += 1
        inferred_discipline = infer_discipline_from_code(path.stem) if infer_discipline_from_code else "unknown"
        declared_discipline = (meta.get("discipline") or "").strip()
        discipline = inferred_discipline if declared_discipline in {"", "unknown"} else declared_discipline
        if discipline == "unknown":
            code = meta.get("paper_code") or path.stem
            prefix = prefix_from_code(code) if prefix_from_code else code[:3]
            unknown_prefixes[prefix or "unknown"] += 1
        has_frontmatter_page_range = bool(meta.get("page_start") and meta.get("page_end"))
        if collection == "ncce" and not has_frontmatter_page_range:
            missing_page += 1
        if collection == "ce_project" and not (
            has_frontmatter_page_range or re.search(r"^#{1,6}\s+Page\s+\d+\s*$", body, re.M | re.I)
        ):
            missing_page += 1
        effective_title = effective_title_for_document(path, body, title_overrides)
        if is_weak_title(effective_title):
            weak_titles += 1
        if ocr_quality_metrics:
            metrics = ocr_quality_metrics(body)
            replacement_rates.append((path.name, float(metrics.get("replacementCharRate", 0))))

    unknown_count = sum(unknown_prefixes.values())
    unknown_rate = unknown_count / max(1, len(files))
    top_noisy = sorted(replacement_rates, key=lambda item: item[1], reverse=True)[:10]
    status = "pass"
    remediation = ""
    if unknown_rate >= 0.02 or weak_titles > 0 or missing_page > 0:
        status = "warn"
        remediation = "GA requires unknown discipline <2%, weak titles=0, and complete page metadata before re-index."

    return Check(
        "markdown_corpus_quality",
        status,
        json.dumps(
            {
                "files": len(files),
                "collections": dict(by_collection),
                "unknownDisciplineCount": unknown_count,
                "unknownDisciplineRate": round(unknown_rate, 4),
                "unmappedPrefixes": unknown_prefixes.most_common(20),
                "missingPageMetadataOrMarkers": missing_page,
                "weakTitleCount": weak_titles,
                "topNoisyDocuments": top_noisy,
            },
            ensure_ascii=False,
        ),
        remediation,
        metrics={
            "fileCount": len(files),
            "unknownDisciplineRate": round(unknown_rate, 4),
            "missingPageMetadataOrMarkers": missing_page,
            "weakTitleCount": weak_titles,
        },
    )


def supabase_quality_check() -> Check:
    env = load_env()
    if not ((env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")) or env.get("SUPABASE_DB_URL")):
        return Check("supabase_index_quality", "warn", "Supabase REST env and SUPABASE_DB_URL missing; DB data-quality check skipped.")
    try:
        try:
            if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
                raise RuntimeError("Supabase REST env missing.")
            from supabase import create_client

            sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
            docs = sb.table("civil_documents_v2").select("id", count="exact").execute().count or 0
            missing_doc_pages = (
                sb.table("civil_documents_v2")
                .select("id", count="exact")
                .or_("page_start.is.null,page_end.is.null")
                .execute()
                .count
                or 0
            )
            missing_chunk_embeddings = (
                sb.table("civil_chunks_v2")
                .select("id", count="exact")
                .is_("embedding", "null")
                .eq("is_stale", False)
                .execute()
                .count
                or 0
            )
            unknown_disciplines = (
                sb.table("civil_documents_v2")
                .select("id", count="exact")
                .eq("discipline", "unknown")
                .execute()
                .count
                or 0
            )
            source = "supabase_rest"
        except Exception as rest_exc:  # noqa: BLE001
            if not env.get("SUPABASE_DB_URL"):
                raise rest_exc
            import psycopg

            with psycopg.connect(env["SUPABASE_DB_URL"], connect_timeout=30) as conn:
                with conn.cursor() as cur:
                    cur.execute("select count(*) from civil_documents_v2")
                    docs = int(cur.fetchone()[0] or 0)
                    cur.execute("select count(*) from civil_documents_v2 where page_start is null or page_end is null")
                    missing_doc_pages = int(cur.fetchone()[0] or 0)
                    cur.execute("select count(*) from civil_chunks_v2 where embedding is null and is_stale = false")
                    missing_chunk_embeddings = int(cur.fetchone()[0] or 0)
                    cur.execute("select count(*) from civil_documents_v2 where discipline = 'unknown'")
                    unknown_disciplines = int(cur.fetchone()[0] or 0)
            source = "supabase_db_url"
        if docs <= 0 or missing_chunk_embeddings > 0 or unknown_disciplines > 0:
            status = "fail"
        elif missing_doc_pages > 0:
            status = "warn"
        else:
            status = "pass"
        return Check(
            "supabase_index_quality",
            status,
            f"source={source}; documents={docs}; missing_doc_pages={missing_doc_pages}; "
            f"missing_chunk_embeddings={missing_chunk_embeddings}; unknown_disciplines={unknown_disciplines}",
            "Run pipeline/index.py after applying schema and extraction updates." if status != "pass" else "",
            metrics={
                "documents": docs,
                "missingDocPages": missing_doc_pages,
                "missingChunkEmbeddings": missing_chunk_embeddings,
                "unknownDisciplines": unknown_disciplines,
                "source": source,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return Check("supabase_index_quality", "warn", f"DB data-quality check skipped: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CivilMCP corpus and index data-quality checks.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when any data-quality check warns.")
    args = parser.parse_args()
    checks = [markdown_integrity_check(), markdown_quality_check(), supabase_quality_check()]
    report = make_report(
        "data_quality",
        checks,
        {
            "strict": args.strict,
            "gaThresholds": {
                "unknownDisciplineRateMaxExclusive": 0.02,
                "weakTitleCount": 0,
                "missingChunkEmbeddings": 0,
                "maxPageMarkerGap": MAX_PAGE_MARKER_GAP,
                "probableDuplicateBodySimilarityMin": DUPLICATE_BODY_SIMILARITY_MIN,
            },
        },
    )
    path = write_report("data_quality", report)
    print_report(report, path)
    if report["status"] == "fail" or (args.strict and report["status"] == "warn"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
