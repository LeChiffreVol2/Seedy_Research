from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from common import ROOT, Check, load_env, make_report, print_report, write_report

try:
    import sys

    sys.path.insert(0, str(ROOT / "pipeline"))
    from metadata import infer_discipline_from_code, prefix_from_code
    from text_quality import ocr_quality_metrics
except Exception:  # pragma: no cover
    infer_discipline_from_code = None
    prefix_from_code = None
    ocr_quality_metrics = None

MD_DIR = ROOT / "pipeline" / "data" / "markdown"


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


def markdown_quality_check() -> Check:
    files = sorted(MD_DIR.glob("*.md"))
    if not files:
        return Check("markdown_corpus_quality", "fail", f"No markdown files in {MD_DIR}", "Run extraction first.")

    by_collection = Counter()
    unknown_prefixes = Counter()
    missing_page = 0
    replacement_rates: list[tuple[str, float]] = []
    weak_titles = 0

    for path in files:
        meta, body = parse_frontmatter(path)
        collection = meta.get("collection") or ("ncce" if path.name.startswith("NCCE") else "ce_project")
        by_collection[collection] += 1
        inferred_discipline = infer_discipline_from_code(path.stem) if infer_discipline_from_code else "unknown"
        discipline = meta.get("discipline") or inferred_discipline
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
        first_heading = re.search(r"^#\s+(.+)$", body, re.M)
        if not first_heading or len(first_heading.group(1).strip()) < 8:
            weak_titles += 1
        if ocr_quality_metrics:
            metrics = ocr_quality_metrics(body)
            replacement_rates.append((path.name, float(metrics.get("replacementCharRate", 0))))

    unknown_count = sum(unknown_prefixes.values())
    unknown_rate = unknown_count / max(1, len(files))
    top_noisy = sorted(replacement_rates, key=lambda item: item[1], reverse=True)[:10]
    status = "pass"
    remediation = ""
    if unknown_rate > 0.35 or missing_page > 0:
        status = "warn"
        remediation = "Review unmapped NCCE prefixes and page metadata before the next production re-index."

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
            source = "supabase_db_url"
        status = "pass" if docs > 0 and missing_chunk_embeddings == 0 else "warn"
        return Check(
            "supabase_index_quality",
            status,
            f"source={source}; documents={docs}; missing_doc_pages={missing_doc_pages}; missing_chunk_embeddings={missing_chunk_embeddings}",
            "Run pipeline/index.py after applying schema and extraction updates." if status != "pass" else "",
            metrics={
                "documents": docs,
                "missingDocPages": missing_doc_pages,
                "missingChunkEmbeddings": missing_chunk_embeddings,
                "source": source,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return Check("supabase_index_quality", "warn", f"DB data-quality check skipped: {exc}")


def main() -> None:
    checks = [markdown_quality_check(), supabase_quality_check()]
    report = make_report("data_quality", checks)
    path = write_report("data_quality", report)
    print_report(report, path)
    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
