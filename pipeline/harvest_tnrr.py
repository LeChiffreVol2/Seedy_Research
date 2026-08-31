"""Bounded, metadata-only harvester for the official TNRR ResearchOutput API.

The command accepts an already-issued bearer token from a server environment
variable. It intentionally does not implement TNRR username/password
authentication and never requests, downloads, or stores full reports. Abstract
contents are discarded before a catalog record is built; only presence flags
are retained until explicit terms permit abstract storage.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional CLI convenience
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT_DIR / "pipeline" / "data" / "catalog" / "tnrr.jsonl"
TNRR_RESEARCH_OUTPUT_ENDPOINT = (
    "https://api.nriis.go.th/service/tnrr/v1/ResearchOutput"
)
TNRR_API_MANUAL_URL = "https://app.nriis.go.th/cdn/tnrr/files/API_TNRR.pdf"
PROVIDER = "tnrr"
COLLECTION = "tnrr_output"
RIGHTS_MANIFEST_VERSION = 1
RIGHTS_ACTIONS = (
    "metadata_indexing",
    "abstract_storage",
    "abstract_embedding",
    "full_text_download",
    "full_text_embedding",
    "summarization",
    "translation",
    "snippet_display",
    "redistribution",
    "commercial_use",
    "model_training",
)
SAFE_RAW_METADATA_FIELDS = {
    "bibid",
    "department",
    "year",
    "doc_type",
    "oecd",
    "link_public",
    "created_at",
    "updated_at",
    "has_full_report_declared",
    "abstract_local_present",
    "abstract_en_present",
    "author_team_count",
}
REVIEWED_CATALOG_FIELDS = (
    "rights_status",
    "rights_manifest_version",
    "rights_manifest",
    "rights_provenance",
    "rights_checked_at",
    "rights_verified_at",
    "access_level",
    "evidence_status",
    "document_id",
)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DATE_PARAM_RE = re.compile(r"^\d{8}$")
ORDER_RE = re.compile(
    r"^(?:bibid|title|author|department|year|doi|docType|createdate|updateDate)"
    r"(?:\.(?:asc|desc))?$",
    re.IGNORECASE,
)
MAX_RESPONSE_BYTES = 16 * 1024 * 1024

PageFetcher = Callable[[dict[str, str]], Any]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_text(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return None
    text = " ".join(str(value).split())
    return text or None


def contains_thai(value: str) -> bool:
    return bool(re.search(r"[\u0E00-\u0E7F]", value))


def normalized_row_keys(row: dict[str, Any]) -> dict[str, Any]:
    return {str(key).strip(): value for key, value in row.items()}


def first_field(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row:
            return row[name]
    return None


def normalize_bibid(value: Any) -> str:
    if isinstance(value, bool):
        raise ValueError("TNRR bibid must be a positive integer.")
    if isinstance(value, int):
        number = value
    else:
        text = normalize_text(value)
        if not text or not text.isdigit():
            raise ValueError("TNRR bibid must be a positive integer.")
        number = int(text)
    if number < 1:
        raise ValueError("TNRR bibid must be a positive integer.")
    return str(number)


def normalize_doi(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    text = urllib.parse.unquote(text)
    match = DOI_RE.search(text)
    return match.group(0).rstrip(".,);").lower() if match else None


def normalize_url(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    parsed = urllib.parse.urlsplit(text)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None
    return urllib.parse.urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc,
            parsed.path,
            parsed.query,
            "",
        )
    )


def normalize_year(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    match = re.search(r"(?<!\d)(\d{4})(?!\d)", text)
    if not match:
        return None
    year = int(match.group(1))
    if 2400 <= year <= 2699:
        year -= 543
    return year if 1000 <= year <= 2999 else None


def _gregorian_date_text(value: str) -> str:
    """Convert a leading Buddhist Era year without altering other fields."""
    match = re.match(r"^(\d{4})(.*)$", value)
    if not match:
        return value
    year = int(match.group(1))
    if 2400 <= year <= 2699:
        return f"{year - 543:04d}{match.group(2)}"
    return value


def normalize_timestamp(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    text = _gregorian_date_text(text)
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text += "T00:00:00+00:00"
    elif text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat()


def normalize_boolean(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    text = str(value).strip().casefold()
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    raise ValueError("TNRR hasfullReport must be true or false when present.")


def content_present(value: Any) -> bool:
    return bool(normalize_text(value))


def _author_values(value: Any) -> Iterable[str]:
    if isinstance(value, list):
        for item in value:
            yield from _author_values(item)
        return
    text = normalize_text(value)
    if not text:
        return
    for part in re.split(r"[;|\n]+", text):
        normalized = normalize_text(part)
        if normalized:
            yield normalized


def normalize_authors(row: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    candidates.extend(_author_values(first_field(row, "author", "Author")))
    candidates.extend(_author_values(first_field(row, "coAuthor", "coauthor")))
    author_team = first_field(row, "authorTeam", "AuthorTeam")
    if isinstance(author_team, list):
        for item in author_team:
            if isinstance(item, dict):
                candidates.extend(
                    _author_values(
                        first_field(
                            normalized_row_keys(item),
                            "authorName",
                            "authorname",
                        )
                    )
                )
    seen: set[str] = set()
    authors: list[str] = []
    for candidate in candidates:
        key = candidate.casefold()
        if key in seen:
            continue
        seen.add(key)
        authors.append(candidate)
    return authors


def metadata_only_rights(checked_at: str) -> dict[str, Any]:
    manifest = {action: False for action in RIGHTS_ACTIONS}
    manifest["metadata_indexing"] = True
    return {
        "rights_manifest_version": RIGHTS_MANIFEST_VERSION,
        "rights_manifest": manifest,
        "rights_provenance": {
            "policy": "tnrr_research_output_metadata_only_v1",
            "basis": "official_bearer_authenticated_metadata_api",
            "provider": PROVIDER,
            "endpoint": TNRR_RESEARCH_OUTPUT_ENDPOINT,
            "api_manual": TNRR_API_MANUAL_URL,
            "has_full_report_is_permission": False,
            "abstract_content_stored": False,
            "automated_rights_inference": False,
        },
        "rights_checked_at": checked_at,
        "rights_verified_at": None,
    }


def record_hash_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        field: record.get(field)
        for field in (
            "provider_record_id",
            "source_type",
            "title_local",
            "title_en",
            "authors",
            "doi",
            "canonical_url",
            "publisher",
            "published_at",
            "raw_metadata",
            "source_updated_at",
        )
    }


def calculate_record_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            record_hash_payload(record),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def canonical_record(raw_row: dict[str, Any], seen_at: str | None = None) -> dict[str, Any]:
    if not isinstance(raw_row, dict):
        raise ValueError("Each TNRR result must be a JSON object.")
    row = normalized_row_keys(raw_row)
    provider_record_id = normalize_bibid(first_field(row, "bibid", "Bibid", "BIBID"))
    title = normalize_text(first_field(row, "title", "Title"))
    if not title:
        raise ValueError(f"TNRR record {provider_record_id} has no title.")

    observed_at = seen_at or utc_now()
    year = normalize_year(first_field(row, "year", "Year"))
    department = normalize_text(first_field(row, "department", "Department"))
    doc_type = normalize_text(first_field(row, "docType", "doctype", "DocType"))
    oecd1 = normalize_text(first_field(row, "oECD1", "OECD1", "oecd1"))
    oecd2 = normalize_text(first_field(row, "oECD2", "OECD2", "oecd2"))
    canonical_url = normalize_url(first_field(row, "linkPublic", "linkpublic"))
    created_at = normalize_timestamp(first_field(row, "createdate", "createDate"))
    source_updated_at = normalize_timestamp(
        first_field(row, "updateDate", "updatedate", "update_date")
    ) or created_at
    author_team = first_field(row, "authorTeam", "AuthorTeam")
    raw_metadata = {
        "bibid": provider_record_id,
        "department": department,
        "year": year,
        "doc_type": doc_type,
        "oecd": {"level_1": oecd1, "level_2": oecd2},
        "link_public": canonical_url,
        "created_at": created_at,
        "updated_at": source_updated_at,
        "has_full_report_declared": normalize_boolean(
            first_field(row, "hasfullReport", "hasFullReport")
        ),
        "abstract_local_present": content_present(
            first_field(row, "abstractTH", "abstractTh", "abstract_th")
        ),
        "abstract_en_present": content_present(
            first_field(row, "abstractEN", "abstractEn", "abstract_en")
        ),
        "author_team_count": len(author_team) if isinstance(author_team, list) else 0,
    }
    title_local = title if contains_thai(title) else None
    title_en = None if title_local else title
    record: dict[str, Any] = {
        "id": f"tnrr:{hashlib.sha256(provider_record_id.encode('utf-8')).hexdigest()[:32]}",
        "provider": PROVIDER,
        "provider_record_id": provider_record_id,
        "collection": COLLECTION,
        "source_type": "research_output",
        "title_local": title_local,
        "title_en": title_en,
        # Explicitly absent until TNRR terms permit abstract storage.
        "abstract_local": None,
        "abstract_en": None,
        "authors": normalize_authors(row),
        "keywords": [value for value in (oecd1, oecd2) if value],
        "doi": normalize_doi(first_field(row, "doi", "DOI")),
        "canonical_url": canonical_url,
        # hasfullReport is an availability flag, never a downloadable asset URL.
        "pdf_url": None,
        "publisher": department,
        "journal_title": None,
        "issn": None,
        "published_at": f"{year:04d}-01-01" if year is not None else None,
        "language": None,
        "discipline": "unknown",
        "license": None,
        "rights_status": "metadata_only_unverified",
        "access_level": "metadata_only",
        "evidence_status": "metadata_only",
        "document_id": None,
        "record_hash": "",
        "raw_metadata": raw_metadata,
        "source_updated_at": source_updated_at,
        "last_seen_at": observed_at,
        "updated_at": observed_at,
    }
    record.update(metadata_only_rights(observed_at))
    record["record_hash"] = calculate_record_hash(record)
    validate_catalog_record(record)
    return record


def validate_catalog_record(record: dict[str, Any]) -> None:
    provider_record_id = str(record.get("provider_record_id") or "")
    expected_id = (
        f"tnrr:{hashlib.sha256(provider_record_id.encode('utf-8')).hexdigest()[:32]}"
    )
    if record.get("provider") != PROVIDER or record.get("collection") != COLLECTION:
        raise ValueError("TNRR catalog identity is invalid.")
    if not provider_record_id.isdigit() or int(provider_record_id) < 1:
        raise ValueError("TNRR provider_record_id is invalid.")
    if record.get("id") != expected_id:
        raise ValueError("TNRR deterministic catalog ID is invalid.")
    if not (record.get("title_local") or record.get("title_en")):
        raise ValueError("TNRR catalog record must have a title.")
    if record.get("abstract_local") is not None or record.get("abstract_en") is not None:
        raise ValueError("TNRR abstract content storage is not permitted.")
    if record.get("pdf_url") is not None or record.get("document_id") is not None:
        raise ValueError("TNRR metadata records cannot contain a full-text asset or document link.")
    if (
        record.get("rights_status") != "metadata_only_unverified"
        or record.get("access_level") != "metadata_only"
        or record.get("evidence_status") != "metadata_only"
    ):
        raise ValueError("TNRR records must remain metadata_only until rights review.")

    manifest = record.get("rights_manifest")
    if not isinstance(manifest, dict) or set(manifest) != set(RIGHTS_ACTIONS):
        raise ValueError("TNRR rights manifest has an invalid shape.")
    for action in RIGHTS_ACTIONS:
        expected = action == "metadata_indexing"
        if manifest.get(action) is not expected:
            raise ValueError(f"TNRR rights action {action} must be {expected}.")
    if record.get("rights_manifest_version") != RIGHTS_MANIFEST_VERSION:
        raise ValueError("TNRR rights manifest version is invalid.")
    if record.get("rights_verified_at") is not None:
        raise ValueError("TNRR automated metadata ingestion cannot verify rights.")

    provenance = record.get("rights_provenance")
    if (
        not isinstance(provenance, dict)
        or provenance.get("policy") != "tnrr_research_output_metadata_only_v1"
        or provenance.get("has_full_report_is_permission") is not False
        or provenance.get("abstract_content_stored") is not False
        or provenance.get("automated_rights_inference") is not False
    ):
        raise ValueError("TNRR rights provenance is not fail-closed.")

    raw_metadata = record.get("raw_metadata")
    if not isinstance(raw_metadata, dict) or set(raw_metadata) != SAFE_RAW_METADATA_FIELDS:
        raise ValueError("TNRR raw metadata contains unreviewed fields.")
    if raw_metadata.get("bibid") != provider_record_id:
        raise ValueError("TNRR raw metadata bibid does not match the catalog identity.")
    if not isinstance(raw_metadata.get("oecd"), dict) or set(raw_metadata["oecd"]) != {
        "level_1",
        "level_2",
    }:
        raise ValueError("TNRR OECD metadata has an invalid shape.")
    for flag in (
        "has_full_report_declared",
        "abstract_local_present",
        "abstract_en_present",
    ):
        if raw_metadata.get(flag) not in (True, False, None):
            raise ValueError(f"TNRR {flag} must be a boolean or null.")
    if record.get("record_hash") != calculate_record_hash(record):
        raise ValueError("TNRR record hash does not match normalized metadata.")


def response_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("data", "results"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                payload = candidate
                break
    if not isinstance(payload, list):
        raise ValueError("TNRR ResearchOutput response must be a JSON array.")
    if not all(isinstance(item, dict) for item in payload):
        raise ValueError("Every TNRR ResearchOutput item must be a JSON object.")
    return payload


def _record_sort_key(record: dict[str, Any]) -> tuple[int, int | str]:
    provider_record_id = record["provider_record_id"]
    if provider_record_id.isdigit():
        return (0, int(provider_record_id))
    return (1, provider_record_id)


def _add_deduplicated(
    records_by_id: dict[str, dict[str, Any]],
    record: dict[str, Any],
) -> None:
    validate_catalog_record(record)
    provider_record_id = record["provider_record_id"]
    prior = records_by_id.get(provider_record_id)
    if prior is None:
        records_by_id[provider_record_id] = record
        return
    if prior["record_hash"] == record["record_hash"]:
        return
    prior_updated = str(prior.get("source_updated_at") or "")
    record_updated = str(record.get("source_updated_at") or "")
    if record_updated > prior_updated:
        records_by_id[provider_record_id] = record
        return
    if record_updated < prior_updated:
        return
    raise ValueError(
        "Conflicting TNRR records share bibid and update timestamp: "
        f"{provider_record_id} ({record_updated or 'missing updateDate'})."
    )


def harvest_pages(
    fetch_page: PageFetcher,
    base_params: dict[str, str] | None = None,
    *,
    start_page: int = 1,
    max_pages: int = 10,
    max_records: int = 1000,
    delay_seconds: float = 1.0,
    seen_at: str | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> list[dict[str, Any]]:
    if start_page < 1:
        raise ValueError("start_page must be at least 1.")
    if max_pages < 1 or max_pages > 1000:
        raise ValueError("max_pages must be between 1 and 1000.")
    if max_records < 1 or max_records > 100_000:
        raise ValueError("max_records must be between 1 and 100000.")
    if delay_seconds < 0:
        raise ValueError("delay_seconds cannot be negative.")

    records_by_id: dict[str, dict[str, Any]] = {}
    page_signatures: set[str] = set()
    observed_at = seen_at or utc_now()
    params_template = dict(base_params or {})
    for page_offset in range(max_pages):
        if page_offset and delay_seconds:
            sleep_fn(delay_seconds)
        page = start_page + page_offset
        params = {**params_template, "page": str(page)}
        rows = response_items(fetch_page(params))
        if not rows:
            break
        normalized_page = [canonical_record(row, seen_at=observed_at) for row in rows]
        signature = hashlib.sha256(
            json.dumps(
                sorted(
                    (record["provider_record_id"], record["record_hash"])
                    for record in normalized_page
                ),
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        if signature in page_signatures:
            raise RuntimeError(
                "TNRR returned a repeated page; harvesting stopped before an infinite loop."
            )
        page_signatures.add(signature)
        for record in normalized_page:
            _add_deduplicated(records_by_id, record)
            if len(records_by_id) >= max_records:
                return sorted(records_by_id.values(), key=_record_sort_key)
    return sorted(records_by_id.values(), key=_record_sort_key)


def read_token_from_env(token_env: str) -> str:
    if not ENV_NAME_RE.fullmatch(token_env):
        raise ValueError("--token-env must be a valid environment variable name.")
    token = os.getenv(token_env)
    if not token or not token.strip():
        raise RuntimeError(f"TNRR bearer token is required in environment variable {token_env}.")
    return token.strip()


def request_research_output(
    token: str,
    params: dict[str, str],
    timeout_seconds: float,
) -> Any:
    if not token:
        raise RuntimeError("TNRR bearer token is required.")
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{TNRR_RESEARCH_OUTPUT_ENDPOINT}?{query}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "CivilMCP-Research-Preview/1.0 (TNRR metadata-only harvester)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"TNRR ResearchOutput request failed with HTTP {exc.code}."
        ) from None
    except urllib.error.URLError:
        raise RuntimeError("TNRR ResearchOutput request could not be completed.") from None
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("TNRR ResearchOutput response exceeded the safety limit.")
    try:
        return json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("TNRR ResearchOutput returned invalid JSON.") from None


def validate_date_param(name: str, value: str | None) -> None:
    if value is None:
        return
    if not DATE_PARAM_RE.fullmatch(value):
        raise ValueError(f"{name} must use YYYYMMDD.")
    try:
        dt.datetime.strptime(value, "%Y%m%d")
    except ValueError:
        raise ValueError(f"{name} is not a valid calendar date.") from None


def build_query_params(args: argparse.Namespace) -> dict[str, str]:
    for name in ("create_from", "create_until", "update_from", "update_until"):
        validate_date_param(f"--{name.replace('_', '-')}", getattr(args, name))
    for start_name, end_name in (
        ("create_from", "create_until"),
        ("update_from", "update_until"),
    ):
        start = getattr(args, start_name)
        end = getattr(args, end_name)
        if start and end and start > end:
            raise ValueError(f"--{start_name.replace('_', '-')} cannot be after --{end_name.replace('_', '-')}.")
    if not ORDER_RE.fullmatch(args.order):
        raise ValueError("--order must name a documented ResearchOutput field and optional .asc/.desc.")

    params: dict[str, str] = {"order": args.order}
    mappings = {
        "title": "title",
        "author": "author",
        "co_author": "coAuthor",
        "department": "department",
        "oecd1": "oECD1",
        "oecd2": "oECD2",
        "create_from": "createfrom",
        "create_until": "createuntil",
        "update_from": "updatefrom",
        "update_until": "updateuntil",
    }
    for argument_name, parameter_name in mappings.items():
        value = getattr(args, argument_name)
        if value is not None and str(value).strip():
            params[parameter_name] = str(value).strip()
    if args.has_full_report is not None:
        params["hasfullReport"] = args.has_full_report
    return params


def write_jsonl(records: list[dict[str, Any]], output_path: Path) -> None:
    seen: set[str] = set()
    for record in records:
        validate_catalog_record(record)
        provider_record_id = record["provider_record_id"]
        if provider_record_id in seen:
            raise ValueError(f"Duplicate TNRR provider_record_id: {provider_record_id}")
        seen.add(provider_record_id)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=output_path.parent,
        text=True,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        os.replace(temp_name, output_path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def preserve_reviewed_catalog_state(
    incoming: dict[str, Any],
    existing: dict[str, Any] | None,
) -> dict[str, Any]:
    if not existing:
        return incoming
    provenance = existing.get("rights_provenance")
    policy = provenance.get("policy") if isinstance(provenance, dict) else None
    reviewed = (
        existing.get("rights_verified_at") is not None
        or existing.get("rights_status") != "metadata_only_unverified"
        or existing.get("evidence_status") != "metadata_only"
        or policy not in (None, "tnrr_research_output_metadata_only_v1")
    )
    if not reviewed:
        return incoming
    merged = dict(incoming)
    for field in REVIEWED_CATALOG_FIELDS:
        if field in existing:
            merged[field] = existing[field]
    return merged


def apply_catalog(records: list[dict[str, Any]]) -> None:
    for record in records:
        validate_catalog_record(record)
    if not records:
        return

    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --apply.")
    client = create_client(url, service_key)
    started_at = utc_now()
    counts: dict[str, Any] = {
        "discovered": len(records),
        "upserted": 0,
        "full_report_downloads": 0,
        "abstracts_stored": 0,
    }
    run_id: str | None = None
    try:
        response = client.table("civil_ingest_runs").insert(
            {
                "provider": PROVIDER,
                "endpoint": TNRR_RESEARCH_OUTPUT_ENDPOINT,
                "mode": "metadata",
                "status": "running",
                "counts": counts,
                "started_at": started_at,
            }
        ).execute()
        rows = getattr(response, "data", None) or []
        if rows:
            run_id = str(rows[0].get("id") or "") or None
    except Exception:
        # Catalog ingestion remains usable before the additive operations table
        # reaches a target environment.
        run_id = None

    try:
        for offset in range(0, len(records), 200):
            batch = records[offset : offset + 200]
            provider_record_ids = [record["provider_record_id"] for record in batch]
            response = (
                client.table("civil_source_catalog")
                .select("provider_record_id," + ",".join(REVIEWED_CATALOG_FIELDS))
                .eq("provider", PROVIDER)
                .in_("provider_record_id", provider_record_ids)
                .execute()
            )
            existing_by_id = {
                row["provider_record_id"]: row
                for row in (getattr(response, "data", None) or [])
            }
            payload = [
                preserve_reviewed_catalog_state(
                    record,
                    existing_by_id.get(record["provider_record_id"]),
                )
                for record in batch
            ]
            client.table("civil_source_catalog").upsert(
                payload,
                on_conflict="provider,provider_record_id",
            ).execute()
            counts["upserted"] += len(payload)
    except Exception as exc:
        if run_id:
            try:
                client.table("civil_ingest_runs").update(
                    {
                        "status": "failed",
                        "counts": counts,
                        "error": f"catalog apply failed ({type(exc).__name__})",
                        "finished_at": utc_now(),
                    }
                ).eq("id", run_id).execute()
            except Exception:
                pass
        raise RuntimeError("TNRR catalog apply failed.") from None

    if run_id:
        try:
            client.table("civil_ingest_runs").update(
                {
                    "status": "completed",
                    "counts": counts,
                    "finished_at": utc_now(),
                }
            ).eq("id", run_id).execute()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Harvest bounded TNRR ResearchOutput metadata into CivilMCP."
    )
    parser.add_argument(
        "--token-env",
        default="TNRR_API_TOKEN",
        help="Name of the server environment variable holding an already-issued bearer token.",
    )
    parser.add_argument("--title")
    parser.add_argument("--author")
    parser.add_argument("--co-author")
    parser.add_argument("--department")
    parser.add_argument("--oecd1")
    parser.add_argument("--oecd2")
    parser.add_argument(
        "--has-full-report",
        choices=("true", "false"),
        help="Metadata availability filter only; reports are never requested or downloaded.",
    )
    parser.add_argument("--create-from", help="Incremental lower create-date bound (YYYYMMDD).")
    parser.add_argument("--create-until", help="Incremental upper create-date bound (YYYYMMDD).")
    parser.add_argument("--update-from", help="Incremental lower update-date bound (YYYYMMDD).")
    parser.add_argument("--update-until", help="Incremental upper update-date bound (YYYYMMDD).")
    parser.add_argument("--order", default="updateDate.asc")
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--max-records", type=int, default=1000)
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Explicitly upsert validated metadata into civil_source_catalog.",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = parse_args()
    if args.timeout_seconds <= 0 or args.timeout_seconds > 120:
        raise ValueError("--timeout-seconds must be greater than 0 and at most 120.")
    token = read_token_from_env(args.token_env)
    query_params = build_query_params(args)

    def fetch_page(params: dict[str, str]) -> Any:
        return request_research_output(token, params, args.timeout_seconds)

    records = harvest_pages(
        fetch_page,
        query_params,
        start_page=args.start_page,
        max_pages=args.max_pages,
        max_records=args.max_records,
        delay_seconds=args.delay_seconds,
    )
    write_jsonl(records, args.output)
    if args.apply:
        apply_catalog(records)
    print(f"TNRR metadata records: {len(records)}")
    print(f"Output: {args.output}")
    print(f"Applied to catalog: {args.apply}")
    print("Full-report downloads: 0")
    print("Abstracts stored: 0")


if __name__ == "__main__":
    main()
