"""
Supabase readiness check for CivilMCP.

What it verifies:
- public.civil_chunks table is reachable via PostgREST
- match_civil_chunks RPC exists
- optional v2 parallel schema for 768-dim hierarchical retrieval

Optional:
- Apply schema.sql via psql if SUPABASE_DB_URL is provided and --apply is used
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT_DIR = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT_DIR / "supabase" / "schema.sql"
V2_DIMENSIONS = 768


def load_env() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if "#" in value:
            value = value.split("#", 1)[0].strip()
        os.environ.setdefault(key, value)


def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required env: {name}")
    return value


def request_json(
    method: str,
    url: str,
    api_key: str,
    body: dict | None = None,
) -> tuple[int, dict | list | str]:
    payload = None
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode("utf-8")

    req = Request(url=url, method=method, headers=headers, data=payload)
    try:
        with urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.getcode(), json.loads(text)
            except json.JSONDecodeError:
                return resp.getcode(), text
    except HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(text)
        except json.JSONDecodeError:
            return exc.code, text
    except URLError as exc:
        return 0, str(exc)


def check_rest_resource(
    supabase_url: str,
    service_key: str,
    resource: str,
    select: str = "id",
) -> bool:
    print(f"Checking table: public.{resource}")
    code, resp = request_json(
        method="GET",
        url=f"{supabase_url}/rest/v1/{resource}?select={select}&limit=1",
        api_key=service_key,
    )
    ok = code == 200
    print(f"- status: {code}")
    if not ok:
        print(f"- detail: {resp}")
    return ok


def check_rpc(
    supabase_url: str,
    service_key: str,
    rpc_name: str,
    body: dict,
) -> bool:
    print(f"Checking RPC: public.{rpc_name}")
    code, resp = request_json(
        method="POST",
        url=f"{supabase_url}/rest/v1/rpc/{rpc_name}",
        api_key=service_key,
        body=body,
    )
    ok = code == 200
    print(f"- status: {code}")
    if not ok:
        print(f"- detail: {resp}")
    return ok


def count_resource(supabase_url: str, service_key: str, resource: str, query: str = "") -> int | None:
    suffix = f"&{query}" if query else ""
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    req = Request(
        url=f"{supabase_url}/rest/v1/{resource}?select=id{suffix}",
        method="GET",
        headers=headers,
    )
    try:
        with urlopen(req, timeout=25) as resp:
            content_range = resp.headers.get("content-range", "")
    except (HTTPError, URLError):
        return None

    if "/" not in content_range:
        return None
    total = content_range.rsplit("/", 1)[-1]
    if not total.isdigit():
        return None
    return int(total)


def apply_schema_via_psql(db_url: str) -> None:
    psql = shutil.which("psql")
    if not psql:
        fallback = Path("/opt/homebrew/opt/libpq/bin/psql")
        if fallback.exists():
            psql = str(fallback)
    if not psql:
        raise RuntimeError("psql not found. Install PostgreSQL client first (e.g. brew install libpq).")
    if not SCHEMA_PATH.exists():
        raise RuntimeError(f"schema.sql not found: {SCHEMA_PATH}")

    cmd = [psql, db_url, "-v", "ON_ERROR_STOP=1", "-f", str(SCHEMA_PATH)]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError("psql schema apply failed. Check SUPABASE_DB_URL, DB password, and network/DNS.")


def reindex_v2_vector_indexes(db_url: str) -> None:
    psql = shutil.which("psql")
    if not psql:
        fallback = Path("/opt/homebrew/opt/libpq/bin/psql")
        if fallback.exists():
            psql = str(fallback)
    if not psql:
        raise RuntimeError("psql not found. Install PostgreSQL client first (e.g. brew install libpq).")

    statements = [
        "set maintenance_work_mem = '64MB';",
        "reindex index public.civil_sections_v2_embedding_ivfflat_idx;",
        "reindex index public.civil_chunks_v2_embedding_ivfflat_idx;",
    ]
    for statement in statements:
        result = subprocess.run([psql, db_url, "-v", "ON_ERROR_STOP=1", "-c", statement], check=False)
        if result.returncode != 0:
            raise RuntimeError(f"psql reindex failed for statement: {statement}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Recheck CivilMCP Supabase readiness.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply supabase/schema.sql with psql using SUPABASE_DB_URL before checks.",
    )
    parser.add_argument(
        "--v2",
        action="store_true",
        help="Also verify v2 parallel schema, 768-dim RPCs, and indexed row counts.",
    )
    parser.add_argument(
        "--reindex-v2",
        action="store_true",
        help="Rebuild v2 IVFFlat indexes after indexing data. Requires SUPABASE_DB_URL.",
    )
    args = parser.parse_args()

    load_env()
    supabase_url = env_required("SUPABASE_URL").rstrip("/")
    service_key = env_required("SUPABASE_SERVICE_KEY").split("#", 1)[0].strip()

    if args.apply:
        db_url = os.getenv("SUPABASE_DB_URL", "").strip()
        if not db_url:
            raise RuntimeError("SUPABASE_DB_URL is required with --apply")
        print("Applying schema.sql via psql ...")
        apply_schema_via_psql(db_url)
        print("Schema applied.")

    if args.reindex_v2:
        db_url = os.getenv("SUPABASE_DB_URL", "").strip()
        if not db_url:
            raise RuntimeError("SUPABASE_DB_URL is required with --reindex-v2")
        print("Rebuilding v2 IVFFlat indexes ...")
        reindex_v2_vector_indexes(db_url)
        print("v2 indexes rebuilt.")

    table_ok = check_rest_resource(supabase_url, service_key, "civil_chunks")
    rpc_ok = check_rpc(
        supabase_url,
        service_key,
        "match_civil_chunks",
        {"query_embedding": [0.0] * 1536, "match_count": 1, "filter_disc": None},
    )

    checks = [table_ok, rpc_ok]

    if args.v2:
        v2_table_checks = [
            check_rest_resource(supabase_url, service_key, "civil_documents_v2"),
            check_rest_resource(supabase_url, service_key, "civil_sections_v2"),
            check_rest_resource(supabase_url, service_key, "civil_chunks_v2"),
            check_rest_resource(supabase_url, service_key, "civil_sections_v2_index_status"),
            check_rest_resource(supabase_url, service_key, "civil_chunks_v2_index_status"),
        ]
        v2_rpc_checks = [
            check_rpc(
                supabase_url,
                service_key,
                "match_civil_sections_v2",
                {
                    "query_embedding": [0.0] * V2_DIMENSIONS,
                    "match_count": 1,
                    "filter_disc": None,
                    "filter_collection": "ce_project",
                },
            ),
            check_rpc(
                supabase_url,
                service_key,
                "match_civil_chunks_v2",
                {
                    "query_embedding": [0.0] * V2_DIMENSIONS,
                    "match_count": 1,
                    "filter_disc": None,
                    "filter_document_ids": None,
                    "filter_section_ids": None,
                    "filter_collection": "ce_project",
                },
            ),
        ]
        checks.extend(v2_table_checks)
        checks.extend(v2_rpc_checks)

        print("Checking v2 row counts")
        doc_count = count_resource(supabase_url, service_key, "civil_documents_v2")
        section_count = count_resource(supabase_url, service_key, "civil_sections_v2")
        chunk_count = count_resource(supabase_url, service_key, "civil_chunks_v2")
        ce_doc_count = count_resource(
            supabase_url,
            service_key,
            "civil_documents_v2",
            "collection=eq.ce_project",
        )
        ncce_doc_count = count_resource(
            supabase_url,
            service_key,
            "civil_documents_v2",
            "collection=eq.ncce",
        )
        ncce_page_missing = count_resource(
            supabase_url,
            service_key,
            "civil_documents_v2",
            "collection=eq.ncce&page_start=is.null",
        )
        missing_section_embeddings = count_resource(
            supabase_url,
            service_key,
            "civil_sections_v2",
            "embedding=is.null&is_stale=eq.false",
        )
        missing_chunk_embeddings = count_resource(
            supabase_url,
            service_key,
            "civil_chunks_v2",
            "embedding=is.null&is_stale=eq.false",
        )
        print(f"- documents: {doc_count}")
        print(f"- ce_project documents: {ce_doc_count}")
        print(f"- ncce documents: {ncce_doc_count}")
        print(f"- ncce documents missing page_start: {ncce_page_missing}")
        print(f"- sections: {section_count}")
        print(f"- chunks: {chunk_count}")
        print(f"- missing section embeddings: {missing_section_embeddings}")
        print(f"- missing chunk embeddings: {missing_chunk_embeddings}")

        embedding_ok = missing_section_embeddings == 0 and missing_chunk_embeddings == 0
        if doc_count == 0 or section_count == 0 or chunk_count == 0:
            embedding_ok = False
        checks.append(embedding_ok)

    if all(checks):
        print("\nREADY: Supabase schema is available for CivilMCP.")
        return 0

    print("\nNOT READY: Run schema.sql on the target Supabase project, then re-run this check.")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
