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
import os
import uuid
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
    work_id = deterministic_uuid("work", f"doi:{paper['doi'].lower()}")
    asset_id = deterministic_uuid("asset", asset["id"])
    source_catalog_id = catalog_id(paper["provider"], paper["providerRecordId"])
    raw_metadata = {
        "source": source,
        "aliases": paper.get("aliases", []),
        "journal_title": paper["journalTitle"],
        "publisher": paper["publisher"],
        "asset_id": asset["id"],
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
            "canonical_key": f"doi:{paper['doi'].lower()}",
            "work_type": "journal_article",
            "title_en": paper["title"],
            "doi_normalized": paper["doi"].lower(),
            "publication_year": int(paper["publishedAt"][:4]),
            "primary_language": asset["language"],
            "identity_strategy": "doi",
            "identity_evidence": {
                "source": paper["sourceUrl"],
                "provider_record_id": paper["providerRecordId"],
                "doi": paper["doi"],
            },
            "canonical_metadata": {
                "authors": paper["authors"],
                "journal_title": paper["journalTitle"],
                "publisher": paper["publisher"],
                "published_at": paper["publishedAt"],
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
            "doi": paper["doi"],
            "canonical_url": paper["sourceUrl"],
            "pdf_url": asset["originUrl"],
            "publisher": paper["publisher"],
            "journal_title": paper["journalTitle"],
            "published_at": paper["publishedAt"],
            "language": asset["language"],
            "discipline": "social_sciences",
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
            "page_count": asset["pageCount"],
            "license_expression": asset["licenseExpression"],
            "rights_status": asset["rightsStatus"],
            "rights_actions": asset["rightsActions"],
            "rights_provenance": rights_provenance,
            "rights_checked_at": asset["rightsCheckedAt"],
            "rights_verified_at": asset["rightsVerifiedAt"],
            "reader_access_mode": "native_verified",
            "access_notes": "CC BY 4.0 publisher version; page text is a checksum-verified extraction.",
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


def apply_rows(rows: list[dict[str, Any]]) -> None:
    from supabase import create_client

    url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required with --apply.")
    client = create_client(url, service_key)
    run_id: str | None = None
    started_at = utc_now()
    counts = {"papers": len(rows), "assets": len(rows), "pages": sum(len(row["pages"]) for row in rows)}
    try:
        response = client.table("civil_ingest_runs").insert({
            "provider": "tci_thaijo",
            "endpoint": "rights-reviewed-reader-pack-v1",
            "mode": "full_text",
            "status": "running",
            "counts": {**counts, "full_text_downloads": 0},
            "started_at": started_at,
        }).execute()
        data = getattr(response, "data", None) or []
        run_id = str(data[0]["id"]) if data else None

        for row in rows:
            existing_work = client.table("civil_works").select("work_id").eq(
                "canonical_key", row["work"]["canonical_key"]
            ).limit(1).execute()
            existing_work_rows = getattr(existing_work, "data", None) or []
            if existing_work_rows:
                resolved_work_id = str(existing_work_rows[0]["work_id"])
                row["work"]["work_id"] = resolved_work_id
                row["catalog"]["work_id"] = resolved_work_id
                row["asset"]["work_id"] = resolved_work_id
            client.table("civil_works").upsert(row["work"], on_conflict="canonical_key").execute()
            client.table("civil_source_catalog").upsert(row["catalog"], on_conflict="provider,provider_record_id").execute()
            existing_asset = client.table("civil_work_assets").select("asset_id").eq(
                "provider", row["asset"]["provider"]
            ).eq("provider_asset_id", row["asset"]["provider_asset_id"]).limit(1).execute()
            existing_asset_rows = getattr(existing_asset, "data", None) or []
            if existing_asset_rows:
                resolved_asset_id = str(existing_asset_rows[0]["asset_id"])
                row["asset"]["asset_id"] = resolved_asset_id
                for page in row["pages"]:
                    page["asset_id"] = resolved_asset_id
            client.table("civil_work_assets").upsert(row["asset"], on_conflict="provider,provider_asset_id").execute()
            pages = row["pages"]
            for offset in range(0, len(pages), 20):
                client.table("civil_fulltext_pages").upsert(
                    pages[offset : offset + 20], on_conflict="asset_id,page_number"
                ).execute()
        if run_id:
            client.table("civil_ingest_runs").update({
                "status": "completed",
                "counts": {**counts, "full_text_downloads": 0, "rights_verified_assets": len(rows)},
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
    }
    if args.apply:
        apply_rows(rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
