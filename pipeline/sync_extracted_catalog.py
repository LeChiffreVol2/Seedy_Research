"""Register extracted local evidence candidates without embedding them."""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MD_DIR = ROOT_DIR / "pipeline" / "data" / "markdown"
TITLE_OVERRIDES_PATH = ROOT_DIR / "web" / "lib" / "paper-title-overrides.json"


def strip_frontmatter(markdown: str) -> tuple[dict[str, str], str]:
    if not markdown.startswith("---\n"):
        return {}, markdown
    end = markdown.find("\n---", 4)
    if end == -1:
        return {}, markdown
    metadata: dict[str, str] = {}
    for line in markdown[4:end].strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
    return metadata, markdown[end + 4 :].lstrip()


def title_for(filename: str, body: str, overrides: dict[str, str], fallback: str) -> str:
    if filename in overrides:
        return overrides[filename]
    match = re.search(r"^#\s+(.+?)\s*$", body, flags=re.MULTILINE)
    return " ".join(match.group(1).split())[:500] if match else fallback


def catalog_record(path: Path, overrides: dict[str, str]) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    metadata, body = strip_frontmatter(raw)
    collection = metadata.get("collection", "ce_project")
    provider = metadata.get("source_provider") or (
        "student_transport_projects" if collection == "ce_project" else "ncce"
    )
    document_id = path.stem
    paper_code = metadata.get("paper_code") or document_id
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        "id": f"{provider}:{document_id}",
        "provider": provider,
        "provider_record_id": document_id,
        "collection": collection,
        "source_type": metadata.get("source_type", "paper"),
        "title_local": title_for(path.name, body, overrides, paper_code),
        "discipline": metadata.get("discipline", "unknown"),
        "rights_status": metadata.get("rights_status", "public_source_no_redistribution"),
        "access_level": metadata.get("access_level", "full_text_local"),
        "evidence_status": "extracted",
        "document_id": None,
        "record_hash": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "raw_metadata": {
            "source": path.name,
            "source_pdf": metadata.get("source_pdf"),
            "parent_source_pdf": metadata.get("parent_source_pdf"),
            "paper_code": metadata.get("paper_code"),
            "page_start": metadata.get("page_start"),
            "page_end": metadata.get("page_end"),
            "proceeding_no": metadata.get("proceeding_no"),
            "proceeding_year": metadata.get("proceeding_year"),
            "extractor": metadata.get("extractor"),
        },
        "source_updated_at": metadata.get("generated_at") or now_iso,
        "last_seen_at": now_iso,
        "updated_at": now_iso,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register extracted markdown in the source catalog.")
    parser.add_argument("--md-dir", type=Path, default=DEFAULT_MD_DIR)
    parser.add_argument("--source-glob", action="append", required=True)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    overrides = (
        json.loads(TITLE_OVERRIDES_PATH.read_text(encoding="utf-8"))
        if TITLE_OVERRIDES_PATH.exists()
        else {}
    )
    files = [
        path
        for path in sorted(args.md_dir.glob("*.md"))
        if any(fnmatch.fnmatch(path.name, pattern) for pattern in args.source_glob)
    ]
    records = [catalog_record(path, overrides) for path in files]
    print(f"Extracted catalog candidates: {len(records)}")
    if not args.apply:
        print("Dry run complete; pass --apply to update Supabase.")
        return

    load_dotenv(ROOT_DIR / ".env")
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --apply.")
    from supabase import create_client

    client = create_client(url, service_key)
    for offset in range(0, len(records), 200):
        client.table("civil_source_catalog").upsert(
            records[offset : offset + 200],
            on_conflict="provider,provider_record_id",
        ).execute()
    print(f"Extracted catalog candidates applied: {len(records)}")


if __name__ == "__main__":
    main()
