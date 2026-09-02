#!/usr/bin/env python3
"""Validate and optionally ingest the rights-reviewed native-reader pack.

Dry-run is the default. `--apply` requires server-only Supabase credentials and
upserts canonical works, source records, assets, and faithful page text. It
never downloads a PDF and never changes a rights decision discovered from a
provider feed; only the reviewed manifest in `web/data/reader-papers` is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACK = ROOT / "web" / "data" / "reader-papers"
UUID_NAMESPACE = uuid.UUID("13d1dc18-8b32-4d8e-9150-ac0833d53f69")
REQUIRED_NATIVE_ACTIONS = (
    "asset_storage",
    "text_extraction",
    "native_fulltext_display",
    "snippet_display",
    "annotation",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def deterministic_uuid(kind: str, value: str) -> str:
    return str(uuid.uuid5(UUID_NAMESPACE, f"{kind}:{value}"))


def catalog_id(provider: str, provider_record_id: str) -> str:
    digest = hashlib.sha256(provider_record_id.encode("utf-8")).hexdigest()[:32]
    return f"{provider}:{digest}"


def record_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def read_pack(pack_dir: Path) -> tuple[dict[str, Any], list[tuple[dict[str, Any], list[dict[str, Any]]]]]:
    manifest = json.loads((pack_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != "civilmcp-rights-reviewed-reader-pack-v1":
        raise ValueError("Unsupported reader-pack manifest version.")
    resolved: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    seen_sources: set[str] = set()
    for paper in manifest.get("papers", []):
        source = str(paper.get("source", "")).strip()
        if not source or source in seen_sources:
            raise ValueError(f"Missing or duplicate reader source: {source!r}")
        seen_sources.add(source)
        asset = paper.get("asset") or {}
        if asset.get("readerAccessMode") != "native_verified":
            raise ValueError(f"Reader asset is not native_verified: {source}")
        if asset.get("rightsStatus") not in ("open_license_verified", "permission_granted"):
            raise ValueError(f"Reader rights are not verified: {source}")
        actions = asset.get("rightsActions") or {}
        if not all(actions.get(action) is True for action in REQUIRED_NATIVE_ACTIONS):
            raise ValueError(f"Reader asset is missing a required action: {source}")
        provenance = asset.get("rightsProvenance") or {}
        if not provenance.get("basis") or not provenance.get("source"):
            raise ValueError(f"Reader asset has no rights provenance: {source}")
        pages_payload = json.loads((pack_dir / paper["pagesFile"]).read_text(encoding="utf-8"))
        pages = pages_payload.get("pages") or []
        if pages_payload.get("source") != source or len(pages) != asset.get("pageCount"):
            raise ValueError(f"Reader page manifest does not match asset: {source}")
        for position, page in enumerate(pages, 1):
            if page.get("pageNumber") != position:
                raise ValueError(f"Reader pages are not contiguous: {source}")
            page_text = str(page.get("text", ""))
            digest = hashlib.sha256(page_text.encode("utf-8")).hexdigest()
            if not page_text.strip() or digest != page.get("textSha256"):
                raise ValueError(f"Reader page integrity failed: {source} page {position}")
        resolved.append((paper, pages))
    if len(resolved) < 3:
        raise ValueError("Reader pack must contain at least three reviewed papers.")
    release_gate = manifest.get("releaseGate")
    if release_gate is not None:
        if not isinstance(release_gate, dict):
            raise ValueError("Reader releaseGate must be an object.")
        minimum = release_gate.get("minimumNativePapers")
        expected = release_gate.get("expectedNativePapers")
        if not isinstance(minimum, int) or minimum < 100:
            raise ValueError("releaseGate.minimumNativePapers must be an integer of at least 100.")
        if not isinstance(expected, int) or expected < minimum:
            raise ValueError("releaseGate.expectedNativePapers must meet minimumNativePapers.")
        if len(resolved) < minimum:
            raise ValueError(
                f"releaseGate.minimumNativePapers={minimum} but the pack contains only {len(resolved)} papers."
            )
        if len(resolved) != expected:
            raise ValueError(
                f"releaseGate.expectedNativePapers={expected} but the pack contains {len(resolved)} papers."
            )
        allowed_types = release_gate.get("allowedArticleTypes")
        if allowed_types != ["Original Article", "Review Article"]:
            raise ValueError("releaseGate.allowedArticleTypes must preserve the reviewed denominator.")
        if release_gate.get("medicalResearchOnly") is not True:
            raise ValueError("releaseGate.medicalResearchOnly must remain true.")
        for paper, _pages in resolved:
            if paper.get("articleType") not in allowed_types:
                raise ValueError(f"Reader release paper has an unapproved article type: {paper.get('source')}")
            if paper.get("tciTier") != "group_1":
                raise ValueError(f"Reader release paper is not TCI Group 1: {paper.get('source')}")
    return manifest, resolved


def catalog_rights(asset: dict[str, Any]) -> dict[str, bool]:
    actions = asset["rightsActions"]
    return {
        "metadata_indexing": True,
        "abstract_storage": False,
        "abstract_embedding": False,
        "full_text_download": bool(actions["source_download"]),
        "full_text_embedding": bool(actions["embedding"]),
        "summarization": bool(actions["summarization"]),
        "translation": bool(actions["translation"]),
        "snippet_display": bool(actions["snippet_display"]),
        "redistribution": bool(actions["redistribution"]),
        "commercial_use": bool(actions["commercial_use"]),
        "model_training": bool(actions["model_training"]),
    }


def build_rows(paper: dict[str, Any], pages: list[dict[str, Any]]) -> dict[str, Any]:
    source = paper["source"]
    asset = paper["asset"]
    raw_doi = str(paper.get("doi") or "").strip()
    doi = raw_doi.lower() or None
    canonical_key = f"doi:{doi}" if doi else f"provider:{paper['provider']}:{paper['providerRecordId']}"
    identity_strategy = "doi" if doi else "provider_identifier"
    work_id = deterministic_uuid("work", canonical_key)
    asset_id = deterministic_uuid("asset", asset["id"])
    source_catalog_id = catalog_id(paper["provider"], paper["providerRecordId"])
    raw_metadata = {
        "source": source,
        "aliases": paper.get("aliases", []),
        "journal_title": paper["journalTitle"],
        "publisher": paper["publisher"],
        "asset_id": asset["id"],
        "article_type": paper.get("articleType"),
        "tci_tier": paper.get("tciTier"),
        "medical_research_only": paper.get("medicalResearchOnly") is True,
        "issue_id": paper.get("issueId"),
        "issue_title": paper.get("issueTitle"),
        "reader_pack_version": "civilmcp-rights-reviewed-reader-pack-v1",
    }
    rights_provenance = {
        **asset["rightsProvenance"],
        "policy": "rights_reviewed_reader_pack_v1",
        "provider": paper["provider"],
        "automated_rights_inference": False,
    }
    return {
        "work": {
            "work_id": work_id,
            "canonical_key": canonical_key,
            "work_type": "journal_article",
            "title_en": paper["title"],
            "doi_normalized": doi,
            "publication_year": int(paper["publishedAt"][:4]),
            "primary_language": asset["language"],
            "identity_strategy": identity_strategy,
            "identity_evidence": {
                "source": paper["sourceUrl"],
                "provider_record_id": paper["providerRecordId"],
                "doi": doi,
            },
            "canonical_metadata": {
                "authors": paper["authors"],
                "journal_title": paper["journalTitle"],
                "publisher": paper["publisher"],
                "published_at": paper["publishedAt"],
                "article_type": paper.get("articleType"),
                "tci_tier": paper.get("tciTier"),
                "medical_research_only": paper.get("medicalResearchOnly") is True,
            },
            "work_status": "active",
            "updated_at": utc_now(),
        },
        "catalog": {
            "id": source_catalog_id,
            "provider": paper["provider"],
            "provider_record_id": paper["providerRecordId"],
            "collection": "tci_journal",
            "source_type": "journal_article",
            "title_en": paper["title"],
            "authors": paper["authors"],
            "doi": doi,
            "canonical_url": paper["sourceUrl"],
            "pdf_url": asset["originUrl"],
            "publisher": paper["publisher"],
            "journal_title": paper["journalTitle"],
            "published_at": paper["publishedAt"],
            "language": asset["language"],
            "discipline": paper.get("discipline") or "social_sciences",
            "license": asset["licenseExpression"],
            "rights_status": asset["rightsStatus"],
            "access_level": "full_text_licensed",
            "evidence_status": "extracted",
            "record_hash": record_hash(raw_metadata),
            "raw_metadata": raw_metadata,
            "rights_manifest_version": 1,
            "rights_manifest": catalog_rights(asset),
            "rights_provenance": rights_provenance,
            "rights_checked_at": asset["rightsCheckedAt"],
            "rights_verified_at": asset["rightsVerifiedAt"],
            "work_id": work_id,
            "last_seen_at": utc_now(),
            "updated_at": utc_now(),
        },
        "asset": {
            "asset_id": asset_id,
            "work_id": work_id,
            "source_catalog_id": source_catalog_id,
            "provider": paper["provider"],
            "provider_asset_id": asset["id"],
            "asset_kind": asset["kind"],
            "version_kind": asset["version"],
            "origin_url": asset["originUrl"],
            "mime_type": asset["mimeType"],
            "language": asset["language"],
            "content_sha256": asset["contentSha256"],
            "byte_size": asset.get("byteSize"),
            "page_count": asset["pageCount"],
            "license_expression": asset["licenseExpression"],
            "rights_status": asset["rightsStatus"],
            "rights_actions": asset["rightsActions"],
            "rights_provenance": rights_provenance,
            "rights_checked_at": asset["rightsCheckedAt"],
            "rights_verified_at": asset["rightsVerifiedAt"],
            "reader_access_mode": "native_verified",
            "access_notes": (
                "CC BY 4.0 publisher version; page text is a checksum-verified extraction. "
                "Biomedical content is provided for research and evidence review, not clinical advice."
                if paper.get("medicalResearchOnly") is True
                else "CC BY 4.0 publisher version; page text is a checksum-verified extraction."
            ),
            "asset_status": "active",
            "last_verified_at": asset["rightsVerifiedAt"],
            "updated_at": utc_now(),
        },
        "pages": [
            {
                "asset_id": asset_id,
                "page_number": page["pageNumber"],
                "page_label": page["pageLabel"],
                "text_role": "faithful_page_extraction",
                "source_text": page["text"],
                "source_text_sha256": page["textSha256"],
                "source_locator": {
                    "origin_url": asset["originUrl"],
                    "page_number": page["pageNumber"],
                    "page_label": page["pageLabel"],
                    "stable_anchor": page["anchor"],
                    "section_title": page["sectionTitle"],
                },
                "extraction_provenance": {
                    "method": "pdftotext-layout",
                    "source_asset_sha256": asset["contentSha256"],
                    "reader_pack_version": "civilmcp-rights-reviewed-reader-pack-v1",
                },
                "updated_at": utc_now(),
            }
            for page in pages
        ],
    }


def plan_apply_batches(
    *,
    paper_count: int,
    page_count: int,
    provider_count: int,
    batch_size: int = 100,
    page_batch_size: int = 100,
) -> dict[str, int]:
    """Return a conservative PostgREST request budget for a bulk apply.

    The estimate is part of the operator-facing dry-run contract: it makes a
    1,000-paper release reviewable before any database or embedding write.
    """
    if paper_count < 0 or page_count < 0 or provider_count < 0:
        raise ValueError("Apply-plan counts cannot be negative.")
    if batch_size < 1 or page_batch_size < 1:
        raise ValueError("Apply-plan batch sizes must be positive.")
    providers = max(1, provider_count) if paper_count else 0
    identity_lookup_batches = math.ceil(paper_count / batch_size) if paper_count else 0
    # Worst case with every observed provider represented: one provider owns
    # almost the whole cohort and each remaining provider owns one record.
    provider_lookup_batches = (
        math.ceil(max(0, paper_count - providers + 1) / batch_size) + providers - 1
        if paper_count else 0
    )
    row_write_batches = 3 * math.ceil(paper_count / batch_size) if paper_count else 0
    page_write_batches = math.ceil(page_count / page_batch_size) if page_count else 0
    run_ledger_requests = 2 if paper_count else 0
    estimated = (
        identity_lookup_batches
        + provider_lookup_batches
        + row_write_batches
        + page_write_batches
        + run_ledger_requests
    )
    # The legacy path issued five per-paper identity/write requests plus at
    # least one page request for every non-empty paper.
    legacy = paper_count * 6 + run_ledger_requests
    return {
        "papers": paper_count,
        "pages": page_count,
        "providers": provider_count,
        "batchSize": batch_size,
        "pageBatchSize": page_batch_size,
        "estimatedApiRequests": estimated,
        "legacyEstimatedApiRequests": legacy,
    }


def _batches(items: list[Any], size: int) -> list[list[Any]]:
    return [items[offset : offset + size] for offset in range(0, len(items), size)]


def _response_rows(response: Any) -> list[dict[str, Any]]:
    return list(getattr(response, "data", None) or [])


def _prepare_existing_identities(client: Any, rows: list[dict[str, Any]], batch_size: int) -> None:
    canonical_keys = list(dict.fromkeys(row["work"]["canonical_key"] for row in rows))
    existing_works: dict[str, str] = {}
    for batch in _batches(canonical_keys, batch_size):
        response = client.table("civil_works").select("canonical_key,work_id").in_(
            "canonical_key", batch
        ).execute()
        existing_works.update({str(item["canonical_key"]): str(item["work_id"]) for item in _response_rows(response)})
    for row in rows:
        resolved_work_id = existing_works.get(row["work"]["canonical_key"])
        if not resolved_work_id:
            continue
        row["work"]["work_id"] = resolved_work_id
        row["catalog"]["work_id"] = resolved_work_id
        row["asset"]["work_id"] = resolved_work_id

    assets_by_provider: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        assets_by_provider[row["asset"]["provider"]].append(row["asset"]["provider_asset_id"])
    existing_assets: dict[tuple[str, str], str] = {}
    for provider, provider_asset_ids in assets_by_provider.items():
        for batch in _batches(list(dict.fromkeys(provider_asset_ids)), batch_size):
            response = client.table("civil_work_assets").select(
                "provider,provider_asset_id,asset_id"
            ).eq("provider", provider).in_("provider_asset_id", batch).execute()
            existing_assets.update({
                (str(item["provider"]), str(item["provider_asset_id"])): str(item["asset_id"])
                for item in _response_rows(response)
            })
    for row in rows:
        asset_key = (row["asset"]["provider"], row["asset"]["provider_asset_id"])
        resolved_asset_id = existing_assets.get(asset_key)
        if not resolved_asset_id:
            continue
        row["asset"]["asset_id"] = resolved_asset_id
        for page in row["pages"]:
            page["asset_id"] = resolved_asset_id


def apply_rows(
    rows: list[dict[str, Any]],
    *,
    batch_size: int = 100,
    page_batch_size: int = 100,
) -> None:
    from supabase import create_client

    url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required with --apply.")
    client = create_client(url, service_key)
    if not 1 <= batch_size <= 200 or not 1 <= page_batch_size <= 200:
        raise ValueError("Database batch sizes must be between 1 and 200.")
    run_id: str | None = None
    started_at = utc_now()
    counts = {"papers": len(rows), "assets": len(rows), "pages": sum(len(row["pages"]) for row in rows)}
    apply_plan = plan_apply_batches(
        paper_count=counts["papers"],
        page_count=counts["pages"],
        provider_count=len({row["asset"]["provider"] for row in rows}),
        batch_size=batch_size,
        page_batch_size=page_batch_size,
    )
    try:
        response = client.table("civil_ingest_runs").insert({
            "provider": "tci_thaijo",
            "endpoint": "rights-reviewed-reader-pack-v1",
            "mode": "full_text",
            "status": "running",
            "counts": {**counts, "full_text_downloads": 0, "apply_plan": apply_plan},
            "started_at": started_at,
        }).execute()
        data = getattr(response, "data", None) or []
        run_id = str(data[0]["id"]) if data else None

        _prepare_existing_identities(client, rows, batch_size)
        works = list({row["work"]["canonical_key"]: row["work"] for row in rows}.values())
        catalogs = [row["catalog"] for row in rows]
        assets = list({
            (row["asset"]["provider"], row["asset"]["provider_asset_id"]): row["asset"]
            for row in rows
        }.values())
        pages = [page for row in rows for page in row["pages"]]
        for batch in _batches(works, batch_size):
            client.table("civil_works").upsert(batch, on_conflict="canonical_key").execute()
        for batch in _batches(catalogs, batch_size):
            client.table("civil_source_catalog").upsert(
                batch, on_conflict="provider,provider_record_id"
            ).execute()
        for batch in _batches(assets, batch_size):
            client.table("civil_work_assets").upsert(
                batch, on_conflict="provider,provider_asset_id"
            ).execute()
        for batch in _batches(pages, page_batch_size):
            client.table("civil_fulltext_pages").upsert(
                batch, on_conflict="asset_id,page_number"
            ).execute()
        if run_id:
            client.table("civil_ingest_runs").update({
                "status": "completed",
                "counts": {
                    **counts,
                    "full_text_downloads": 0,
                    "rights_verified_assets": len(rows),
                    "apply_plan": apply_plan,
                },
                "finished_at": utc_now(),
            }).eq("id", run_id).execute()
    except Exception as exc:
        if run_id:
            try:
                client.table("civil_ingest_runs").update({
                    "status": "failed",
                    "counts": counts,
                    "error": str(exc)[:1000],
                    "finished_at": utc_now(),
                }).eq("id", run_id).execute()
            except Exception:
                pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack-dir", type=Path, default=DEFAULT_PACK)
    parser.add_argument("--apply", action="store_true", help="Mutate the configured Supabase project.")
    parser.add_argument("--batch-size", type=int, default=100, help="Works/catalog/assets per PostgREST upsert (1-200).")
    parser.add_argument("--page-batch-size", type=int, default=100, help="Full-text pages per PostgREST upsert (1-200).")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    _, papers = read_pack(args.pack_dir.resolve())
    rows = [build_rows(paper, pages) for paper, pages in papers]
    summary = {
        "status": "ready_to_apply" if not args.apply else "applied",
        "papers": len(rows),
        "assets": len(rows),
        "pages": sum(len(row["pages"]) for row in rows),
        "full_text_downloads": 0,
        "sources": [row["catalog"]["provider_record_id"] for row in rows],
        "applyPlan": plan_apply_batches(
            paper_count=len(rows),
            page_count=sum(len(row["pages"]) for row in rows),
            provider_count=len({row["asset"]["provider"] for row in rows}),
            batch_size=args.batch_size,
            page_batch_size=args.page_batch_size,
        ),
    }
    if args.apply:
        apply_rows(rows, batch_size=args.batch_size, page_batch_size=args.page_batch_size)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
