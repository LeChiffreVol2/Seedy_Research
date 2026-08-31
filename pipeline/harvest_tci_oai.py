"""Bounded, metadata-only harvester for official ThaiJO OAI-PMH endpoints.

This command never downloads article PDFs. Records enter the source catalog as
metadata_only until a separate rights and page-provenance review promotes them
to the evidence index.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Iterable

from source_registry import source_spec

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT_DIR / "pipeline" / "data" / "catalog" / "tci_thaijo.jsonl"
DEFAULT_ALLOWLIST = ROOT_DIR / "pipeline" / "tci_source_allowlist.json"
DEFAULT_ENDPOINT_REGISTRY = ROOT_DIR / "pipeline" / "tci_official_endpoint_registry.json"
OAI_NS = "http://www.openarchives.org/OAI/2.0/"
OAI_DC_NS = "http://www.openarchives.org/OAI/2.0/oai_dc/"
DC_NS = "http://purl.org/dc/elements/1.1/"
NS = {"oai": OAI_NS, "oai_dc": OAI_DC_NS, "dc": DC_NS}
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?\b")
XML_ILLEGAL_CONTROL_BYTES_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")
XML_ILLEGAL_CONTROL_TEXT_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")
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
CATALOG_STATE_FIELDS = REVIEWED_CATALOG_FIELDS + (
    "record_hash",
    "raw_metadata",
)
OFFICIAL_BROAD_DISCIPLINES = {
    "science",
    "life_sciences",
    "physical_sciences",
    "health_sciences",
    "social_sciences",
}
NON_RESEARCH_CONTAINER_TITLES = {
    "full issue",
    "ฉบับเต็ม",
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def contains_thai(value: str) -> bool:
    return bool(re.search(r"[\u0E00-\u0E7F]", value))


def first_by_language(values: list[str], thai: bool) -> str | None:
    return next((value for value in values if contains_thai(value) is thai), None)


def normalized_date(values: list[str]) -> str | None:
    for value in values:
        match = DATE_RE.search(value)
        if not match:
            continue
        year, month, day = match.groups()
        return f"{year}-{month or '01'}-{day or '01'}"
    return None


def values_for(dc: ET.Element, name: str) -> list[str]:
    values: list[str] = []
    for node in dc.findall(f"dc:{name}", NS):
        value = " ".join((node.text or "").split())
        if value:
            values.append(value)
    return values


def sanitize_xml_payload(xml_payload: bytes | str) -> bytes | str:
    """Drop bytes XML 1.0 forbids; ThaiJO occasionally emits them in abstracts."""
    if isinstance(xml_payload, bytes):
        return XML_ILLEGAL_CONTROL_BYTES_RE.sub(b"", xml_payload)
    return XML_ILLEGAL_CONTROL_TEXT_RE.sub("", xml_payload)


def reviewed_source_scope(
    endpoint: str,
    set_spec: str | None,
    allowlist_path: Path = DEFAULT_ALLOWLIST,
) -> str | None:
    """Return the reviewed discipline only for an exact endpoint/set pair."""
    if not set_spec:
        return None
    payload = json.loads(allowlist_path.read_text(encoding="utf-8"))
    normalized_endpoint = endpoint.rstrip("/?")
    for source in payload.get("endpoints", []):
        if str(source.get("endpoint", "")).rstrip("/?") != normalized_endpoint:
            continue
        for reviewed_set in source.get("sets", []):
            if reviewed_set.get("set_spec") == set_spec:
                scope = str(reviewed_set.get("scope", "")).strip()
                return scope or None
    return None


def reviewed_source_sets(
    endpoint: str,
    allowlist_path: Path = DEFAULT_ALLOWLIST,
) -> list[dict[str, str]]:
    """Return the reviewed sets for one exact endpoint in manifest order."""
    payload = json.loads(allowlist_path.read_text(encoding="utf-8"))
    normalized_endpoint = endpoint.rstrip("/?")
    for source in payload.get("endpoints", []):
        if str(source.get("endpoint", "")).rstrip("/?") != normalized_endpoint:
            continue
        reviewed: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in source.get("sets", []):
            set_spec = str(item.get("set_spec", "")).strip()
            scope = str(item.get("scope", "")).strip()
            if not set_spec or not scope or set_spec in seen:
                continue
            seen.add(set_spec)
            reviewed.append({
                "set_spec": set_spec,
                "label": str(item.get("label", set_spec)).strip() or set_spec,
                "scope": scope,
            })
        return reviewed
    return []


def official_endpoint_registration(
    endpoint: str,
    registry_path: Path = DEFAULT_ENDPOINT_REGISTRY,
) -> dict[str, Any] | None:
    """Return provenance for an exact official ThaiJO endpoint match."""
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    version = payload.get("version")
    source_url = str(payload.get("source_url", "")).strip()
    normalized_endpoint = endpoint.rstrip("/")
    for item in payload.get("endpoints", []):
        registered_endpoint = str(item.get("endpoint", "")).rstrip("/")
        if registered_endpoint != normalized_endpoint:
            continue
        discipline = str(item.get("discipline", "")).strip()
        if discipline not in OFFICIAL_BROAD_DISCIPLINES:
            raise ValueError(f"Unsafe official ThaiJO discipline label: {discipline!r}")
        return {
            "registry_version": version,
            "registry_source_url": source_url,
            "endpoint": registered_endpoint,
            "endpoint_family": str(item.get("family", "")).strip(),
            "discipline": discipline,
            "match": "exact_endpoint",
        }
    return None


def apply_endpoint_discipline(
    record: dict[str, Any],
    registration: dict[str, Any],
) -> dict[str, Any]:
    """Apply a registry fallback and keep its provenance inside raw metadata."""
    record["discipline"] = registration["discipline"]
    raw_metadata = dict(record.get("raw_metadata") or {})
    raw_metadata["discipline_provenance"] = {
        "policy": "tci_thaijo_official_endpoint_registry_v1",
        **registration,
    }
    record["raw_metadata"] = raw_metadata
    record["record_hash"] = hashlib.sha256(
        json.dumps(raw_metadata, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return record


def load_catalog_records(path: Path, endpoint: str) -> list[dict[str, Any]]:
    """Load one generated JSONL safely so a failed apply can resume offline."""
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    normalized_endpoint = endpoint.rstrip("/?")
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        provider_record_id = str(record.get("provider_record_id", "")).strip()
        raw_metadata = record.get("raw_metadata")
        record_endpoint = (
            str(raw_metadata.get("endpoint", "")).rstrip("/?")
            if isinstance(raw_metadata, dict)
            else ""
        )
        if record.get("provider") != "tci_thaijo" or record_endpoint != normalized_endpoint:
            raise ValueError(f"Line {line_number} is not from the selected ThaiJO endpoint.")
        if not provider_record_id or provider_record_id in seen:
            raise ValueError(f"Line {line_number} has a missing or duplicate provider record ID.")
        seen.add(provider_record_id)
        records.append(record)
    if not records:
        raise ValueError("The catalog JSONL contains no records.")
    return records


def deduplicate_catalog_records(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return one deterministic row per provider identifier.

    Some ThaiJO endpoint-wide OAI feeds repeat an identical header across
    resumption-token pages. Postgres cannot safely upsert the same conflict key
    twice in one statement, so generated JSONL must be unique before it is
    written or applied. A newer datestamp wins; a tombstone wins a timestamp
    tie. Two different active payloads at the same datestamp are rejected for
    review instead of choosing one silently.
    """
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        provider_record_id = str(record.get("provider_record_id", "")).strip()
        if not provider_record_id:
            raise ValueError("ThaiJO record is missing provider_record_id.")
        prior = by_id.get(provider_record_id)
        if prior is None:
            by_id[provider_record_id] = record
            continue
        if prior.get("record_hash") == record.get("record_hash"):
            continue

        prior_updated = str(prior.get("source_updated_at") or "")
        record_updated = str(record.get("source_updated_at") or "")
        if record_updated > prior_updated:
            by_id[provider_record_id] = record
            continue
        if record_updated < prior_updated:
            continue

        prior_removed = is_oai_tombstone(prior)
        record_removed = is_oai_tombstone(record)
        if prior_removed != record_removed:
            if record_removed:
                by_id[provider_record_id] = record
            continue
        raise ValueError(
            "Conflicting ThaiJO records share provider_record_id and source datestamp: "
            f"{provider_record_id} ({record_updated or 'missing datestamp'})."
        )
    return list(by_id.values())


def is_non_research_container(record: dict[str, Any]) -> bool:
    """Identify provider rows that represent a whole issue, not one paper."""
    if is_oai_tombstone(record):
        return False
    raw_metadata = record.get("raw_metadata")
    titles = raw_metadata.get("titles") if isinstance(raw_metadata, dict) else []
    normalized = {
        " ".join(str(title).split()).casefold()
        for title in (titles if isinstance(titles, list) else [])
        if str(title).strip()
    }
    return bool(normalized & NON_RESEARCH_CONTAINER_TITLES)


def catalog_eligible_records(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep paper-like metadata plus tombstones required for reconciliation."""
    return [record for record in records if not is_non_research_container(record)]


def thaijo_metadata_rights(
    endpoint: str,
    declared_rights: list[str],
    checked_at: str,
) -> dict[str, Any]:
    """Return the non-promoting policy for provider-published OAI metadata."""
    manifest = {action: False for action in RIGHTS_ACTIONS}
    manifest["metadata_indexing"] = True
    manifest["abstract_storage"] = True
    return {
        "rights_manifest_version": RIGHTS_MANIFEST_VERSION,
        "rights_manifest": manifest,
        "rights_provenance": {
            "policy": "tci_thaijo_oai_metadata_only_v1",
            "basis": "official_oai_pmh_metadata_feed",
            "provider": "tci_thaijo",
            "endpoint": endpoint,
            "declared_rights": declared_rights,
            # A string such as "CC BY" still requires separate verification.
            "automated_rights_inference": False,
        },
        "rights_checked_at": checked_at,
        "rights_verified_at": None,
    }


def thaijo_tombstone_rights(
    endpoint: str,
    source_deleted_at: str | None,
    checked_at: str,
) -> dict[str, Any]:
    """Return a default-deny policy for an OAI deleted-record header."""
    manifest = {action: False for action in RIGHTS_ACTIONS}
    manifest["metadata_indexing"] = True
    return {
        "rights_manifest_version": RIGHTS_MANIFEST_VERSION,
        "rights_manifest": manifest,
        "rights_provenance": {
            "policy": "tci_thaijo_oai_deleted_v1",
            "basis": "official_oai_pmh_deleted_header",
            "provider": "tci_thaijo",
            "endpoint": endpoint,
            "source_deleted_at": source_deleted_at,
            "automated_rights_inference": False,
        },
        "rights_checked_at": checked_at,
        "rights_verified_at": None,
    }


def is_oai_tombstone(record: dict[str, Any]) -> bool:
    raw_metadata = record.get("raw_metadata")
    if not isinstance(raw_metadata, dict):
        return False
    tombstone = raw_metadata.get("oai_tombstone")
    return isinstance(tombstone, dict) and tombstone.get("status") == "deleted"


def tombstone_catalog_update(
    incoming: dict[str, Any],
    existing: dict[str, Any],
) -> dict[str, Any]:
    """Build the narrow, repeatable mutation for a previously known record.

    Rights decisions, access level, document linkage, and previously harvested
    metadata stay intact. The catalog status alone removes the source from
    discovery, while the nested OAI header provides a reversible audit trail.
    """
    if not is_oai_tombstone(incoming):
        raise ValueError("Expected an OAI tombstone record.")

    existing_raw = existing.get("raw_metadata")
    merged_raw = dict(existing_raw) if isinstance(existing_raw, dict) else {}
    incoming_raw = incoming["raw_metadata"]
    incoming_tombstone = dict(incoming_raw["oai_tombstone"])
    previous_tombstone = merged_raw.get("oai_tombstone")
    previous_hash = (
        previous_tombstone.get("prior_record_hash")
        if isinstance(previous_tombstone, dict)
        else None
    )
    current_hash = existing.get("record_hash")
    if previous_hash:
        incoming_tombstone["prior_record_hash"] = previous_hash
    elif current_hash and current_hash != incoming.get("record_hash"):
        incoming_tombstone["prior_record_hash"] = current_hash
    merged_raw["oai_tombstone"] = incoming_tombstone

    return {
        "evidence_status": "removed",
        "record_hash": incoming["record_hash"],
        "raw_metadata": merged_raw,
        "source_updated_at": incoming.get("source_updated_at"),
        "last_seen_at": incoming["last_seen_at"],
        "updated_at": incoming["updated_at"],
    }


def preserve_reviewed_catalog_state(
    incoming: dict[str, Any],
    existing: dict[str, Any] | None,
) -> dict[str, Any]:
    """Keep human-reviewed rights and any separately promoted evidence link."""
    if not existing:
        return incoming
    provenance = existing.get("rights_provenance")
    policy = provenance.get("policy") if isinstance(provenance, dict) else None
    reviewed = (
        existing.get("rights_verified_at") is not None
        or existing.get("rights_status") != "metadata_only_unverified"
        or existing.get("evidence_status") != "metadata_only"
        or policy not in (None, "tci_thaijo_oai_metadata_only_v1")
    )
    if not reviewed:
        return incoming
    merged = dict(incoming)
    for field in REVIEWED_CATALOG_FIELDS:
        if field in existing:
            merged[field] = existing[field]
    return merged


def canonical_record(endpoint: str, record: ET.Element) -> dict[str, Any] | None:
    header = record.find("oai:header", NS)
    if header is None:
        return None
    provider_record_id = (header.findtext("oai:identifier", default="", namespaces=NS) or "").strip()
    if not provider_record_id:
        return None
    if header.get("status") == "deleted":
        spec = source_spec("tci_thaijo")
        seen_at = utc_now()
        source_deleted_at = header.findtext("oai:datestamp", default=None, namespaces=NS)
        raw_metadata = {
            "endpoint": endpoint,
            "set_specs": [
                " ".join((node.text or "").split())
                for node in header.findall("oai:setSpec", NS)
                if (node.text or "").strip()
            ],
            "oai_tombstone": {
                "status": "deleted",
                "datestamp": source_deleted_at,
                "provider_record_id": provider_record_id,
            },
        }
        record_hash = hashlib.sha256(
            json.dumps(raw_metadata, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        catalog_record = {
            "id": f"tci_thaijo:{hashlib.sha256(provider_record_id.encode('utf-8')).hexdigest()[:32]}",
            "provider": spec.provider,
            "provider_record_id": provider_record_id,
            "collection": spec.collection,
            "source_type": "journal_article",
            "title_local": None,
            "title_en": None,
            "abstract_local": None,
            "abstract_en": None,
            "authors": [],
            "keywords": [],
            "doi": None,
            "canonical_url": None,
            "pdf_url": None,
            "publisher": None,
            "journal_title": None,
            "issn": None,
            "published_at": None,
            "language": None,
            "discipline": "unknown",
            "license": None,
            "rights_status": "removed",
            "access_level": "metadata_only",
            "evidence_status": "removed",
            "document_id": None,
            "record_hash": record_hash,
            "raw_metadata": raw_metadata,
            "source_updated_at": source_deleted_at,
            "last_seen_at": seen_at,
            "updated_at": seen_at,
        }
        catalog_record.update(
            thaijo_tombstone_rights(endpoint, source_deleted_at, seen_at)
        )
        return catalog_record
    dc = record.find("oai:metadata/oai_dc:dc", NS)
    if dc is None:
        return None

    titles = values_for(dc, "title")
    descriptions = values_for(dc, "description")
    identifiers = values_for(dc, "identifier")
    rights = values_for(dc, "rights")
    sources = values_for(dc, "source")
    doi = next(
        (match.group(0).rstrip(".,);") for value in identifiers for match in [DOI_RE.search(value)] if match),
        None,
    )
    urls = [value for value in identifiers if value.lower().startswith(("http://", "https://"))]
    pdf_url = next((value for value in urls if ".pdf" in value.lower()), None)
    canonical_url = next((value for value in urls if value != pdf_url), None)
    raw_metadata = {
        "endpoint": endpoint,
        "set_specs": [
            " ".join((node.text or "").split())
            for node in header.findall("oai:setSpec", NS)
            if (node.text or "").strip()
        ],
        "titles": titles,
        "creators": values_for(dc, "creator"),
        "subjects": values_for(dc, "subject"),
        "descriptions": descriptions,
        "publishers": values_for(dc, "publisher"),
        "contributors": values_for(dc, "contributor"),
        "dates": values_for(dc, "date"),
        "types": values_for(dc, "type"),
        "formats": values_for(dc, "format"),
        "identifiers": identifiers,
        "sources": sources,
        "languages": values_for(dc, "language"),
        "relations": values_for(dc, "relation"),
        "coverage": values_for(dc, "coverage"),
        "rights": rights,
    }
    record_hash = hashlib.sha256(
        json.dumps(raw_metadata, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    spec = source_spec("tci_thaijo")
    seen_at = utc_now()
    catalog_record = {
        "id": f"tci_thaijo:{hashlib.sha256(provider_record_id.encode('utf-8')).hexdigest()[:32]}",
        "provider": spec.provider,
        "provider_record_id": provider_record_id,
        "collection": spec.collection,
        "source_type": "journal_article",
        "title_local": first_by_language(titles, thai=True),
        "title_en": first_by_language(titles, thai=False) or (titles[0] if titles else None),
        "abstract_local": first_by_language(descriptions, thai=True),
        "abstract_en": first_by_language(descriptions, thai=False),
        "authors": raw_metadata["creators"],
        "keywords": raw_metadata["subjects"],
        "doi": doi,
        "canonical_url": canonical_url,
        # Kept for catalog inspection only. It is never fetched by this command.
        "pdf_url": pdf_url,
        "publisher": raw_metadata["publishers"][0] if raw_metadata["publishers"] else None,
        "journal_title": sources[0] if sources else None,
        "issn": None,
        "published_at": normalized_date(raw_metadata["dates"]),
        "language": ",".join(raw_metadata["languages"]) or None,
        "discipline": "unknown",
        "license": rights[0] if rights else None,
        "rights_status": spec.default_rights_status,
        "access_level": "metadata_only",
        "evidence_status": "metadata_only",
        "document_id": None,
        "record_hash": record_hash,
        "raw_metadata": raw_metadata,
        "source_updated_at": header.findtext("oai:datestamp", default=None, namespaces=NS),
        "last_seen_at": seen_at,
        "updated_at": seen_at,
    }
    catalog_record.update(thaijo_metadata_rights(endpoint, rights, seen_at))
    return catalog_record


def parse_list_records(endpoint: str, xml_payload: bytes | str) -> tuple[list[dict[str, Any]], str | None]:
    root = ET.fromstring(sanitize_xml_payload(xml_payload))
    error = root.find("oai:error", NS)
    if error is not None:
        code = error.get("code", "unknown")
        if code == "noRecordsMatch":
            return [], None
        raise RuntimeError(f"OAI-PMH error {code}: {' '.join((error.text or '').split())}")
    records = [
        parsed
        for record in root.findall("oai:ListRecords/oai:record", NS)
        for parsed in [canonical_record(endpoint, record)]
        if parsed is not None
    ]
    token_node = root.find("oai:ListRecords/oai:resumptionToken", NS)
    token = " ".join((token_node.text or "").split()) if token_node is not None else ""
    return records, token or None


def parse_list_sets(xml_payload: bytes | str) -> list[tuple[str, str]]:
    root = ET.fromstring(sanitize_xml_payload(xml_payload))
    error = root.find("oai:error", NS)
    if error is not None:
        code = error.get("code", "unknown")
        raise RuntimeError(f"OAI-PMH error {code}: {' '.join((error.text or '').split())}")
    return [
        (
            " ".join((node.findtext("oai:setSpec", default="", namespaces=NS) or "").split()),
            " ".join((node.findtext("oai:setName", default="", namespaces=NS) or "").split()),
        )
        for node in root.findall("oai:ListSets/oai:set", NS)
    ]


def request_xml(endpoint: str, params: dict[str, str], timeout_seconds: float) -> bytes:
    url = f"{endpoint}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "CivilMCP-Research-Preview/1.0 (metadata-only OAI harvester)"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read()


def harvest(
    endpoint: str,
    set_spec: str | None,
    date_from: str | None,
    date_until: str | None,
    max_records: int,
    delay_seconds: float,
    timeout_seconds: float,
) -> Iterable[dict[str, Any]]:
    params = {"verb": "ListRecords", "metadataPrefix": "oai_dc"}
    if set_spec:
        params["set"] = set_spec
    if date_from:
        params["from"] = date_from
    if date_until:
        params["until"] = date_until

    emitted = 0
    request_count = 0
    while emitted < max_records:
        if request_count:
            time.sleep(delay_seconds)
        payload = request_xml(endpoint, params, timeout_seconds)
        request_count += 1
        records, token = parse_list_records(endpoint, payload)
        for record in records:
            yield record
            emitted += 1
            if emitted >= max_records:
                return
        if not token:
            return
        params = {"verb": "ListRecords", "resumptionToken": token}


def apply_catalog(records: list[dict[str, Any]], endpoint: str, set_spec: str | None) -> None:
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --apply.")
    client = create_client(url, service_key)
    started_at = utc_now()
    run_counts: dict[str, Any] = {
        "discovered": len(records),
        "upserted": 0,
        "tombstones_seen": sum(is_oai_tombstone(record) for record in records),
        "tombstones_applied": 0,
        "set_spec": set_spec,
        "full_text_downloads": 0,
    }
    run_id: str | None = None
    try:
        response = client.table("civil_ingest_runs").insert({
            "provider": "tci_thaijo",
            "endpoint": endpoint,
            "mode": "metadata",
            "status": "running",
            "counts": run_counts,
            "started_at": started_at,
        }).execute()
        rows = getattr(response, "data", None) or []
        if rows:
            run_id = str(rows[0].get("id") or "") or None
    except Exception:
        # Catalog ingestion remains compatible with deployments where the
        # additive operations table has not reached the target yet.
        run_id = None

    try:
        for offset in range(0, len(records), 200):
            batch = records[offset : offset + 200]
            record_ids = [record["provider_record_id"] for record in batch]
            existing_response = (
                client.table("civil_source_catalog")
                .select("provider_record_id," + ",".join(CATALOG_STATE_FIELDS))
                .eq("provider", "tci_thaijo")
                .in_("provider_record_id", record_ids)
                .execute()
            )
            existing_by_id = {
                row["provider_record_id"]: row
                for row in (getattr(existing_response, "data", None) or [])
            }
            payload: list[dict[str, Any]] = []
            for record in batch:
                provider_record_id = record["provider_record_id"]
                existing = existing_by_id.get(provider_record_id)
                if is_oai_tombstone(record) and existing:
                    client.table("civil_source_catalog").update(
                        tombstone_catalog_update(record, existing)
                    ).eq("provider", "tci_thaijo").eq(
                        "provider_record_id", provider_record_id
                    ).execute()
                    run_counts["tombstones_applied"] += 1
                    continue
                payload.append(preserve_reviewed_catalog_state(record, existing))
                if is_oai_tombstone(record):
                    run_counts["tombstones_applied"] += 1
            if payload:
                client.table("civil_source_catalog").upsert(
                    payload,
                    on_conflict="provider,provider_record_id",
                ).execute()
                run_counts["upserted"] += len(payload)
    except Exception as exc:
        if run_id:
            try:
                client.table("civil_ingest_runs").update({
                    "status": "failed",
                    "counts": run_counts,
                    "error": str(exc)[:1000],
                    "finished_at": utc_now(),
                }).eq("id", run_id).execute()
            except Exception:
                pass
        raise

    if run_id:
        try:
            client.table("civil_ingest_runs").update({
                "status": "completed",
                "counts": run_counts,
                "finished_at": utc_now(),
            }).eq("id", run_id).execute()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Harvest bounded ThaiJO OAI metadata into CivilMCP.")
    parser.add_argument("--endpoint", required=True, help="Official ThaiJO OAI endpoint, without query string.")
    parser.add_argument("--set-spec")
    parser.add_argument(
        "--all-reviewed",
        action="store_true",
        help="Harvest every allowlisted set for the selected endpoint, with the rate limit enforced between sets.",
    )
    parser.add_argument(
        "--discipline",
        choices=[
            "unknown",
            "science",
            "life_sciences",
            "physical_sciences",
            "health_sciences",
            "social_sciences",
            "transport",
            "structural",
            "geotechnical",
            "construction_mgmt",
            "water_resources",
            "surveying_gis",
            "environmental",
            "infrastructure",
            "civil_education",
            "ai_engineering",
        ],
        default="unknown",
        help="Reviewed discipline for the selected journal set.",
    )
    parser.add_argument(
        "--list-sets",
        action="store_true",
        help="List the endpoint's journal sets and exit without harvesting records.",
    )
    parser.add_argument(
        "--allow-unscoped",
        action="store_true",
        help="Explicitly allow endpoint-wide harvesting. Prefer a reviewed --set-spec.",
    )
    parser.add_argument(
        "--allow-unreviewed-set",
        action="store_true",
        help="Explicitly allow a set absent from tci_source_allowlist.json.",
    )
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--until", dest="date_until")
    parser.add_argument(
        "--max-records",
        type=int,
        default=100,
        help="Maximum records for one set; with --all-reviewed this cap applies per set.",
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=6.2,
        help="Delay between requests. Default stays below ThaiJO's published 10 requests/minute limit.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=30)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apply", action="store_true", help="Upsert metadata into civil_source_catalog.")
    parser.add_argument(
        "--apply-existing",
        action="store_true",
        help="Apply the existing --output JSONL without requesting ThaiJO again; requires --apply.",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = parse_args()
    if not args.endpoint.startswith("https://"):
        raise ValueError("--endpoint must use HTTPS.")
    if args.max_records < 1 or args.max_records > 2000:
        raise ValueError("--max-records must be between 1 and 2000.")
    if args.delay_seconds < 6:
        raise ValueError("--delay-seconds must be at least 6 seconds for ThaiJO.")
    endpoint = args.endpoint.rstrip("?")
    if args.apply_existing:
        if not args.apply:
            raise ValueError("--apply-existing requires --apply.")
        if args.list_sets or args.set_spec or args.all_reviewed:
            raise ValueError("--apply-existing cannot be combined with a harvest selection.")
        records = load_catalog_records(args.output, endpoint)
        apply_catalog(records, endpoint=endpoint, set_spec="existing_jsonl")
        print(f"TCI/ThaiJO metadata records: {len(records)}")
        print(f"Input: {args.output}")
        print("Applied to catalog: True")
        print("Full-text downloads: 0")
        return
    if args.list_sets:
        for set_spec, set_name in parse_list_sets(
            request_xml(endpoint, {"verb": "ListSets"}, args.timeout_seconds)
        ):
            print(f"{set_spec}\t{set_name}")
        return
    if args.all_reviewed and args.set_spec:
        raise ValueError("Choose either --set-spec or --all-reviewed, not both.")
    if not args.set_spec and not args.all_reviewed and not args.allow_unscoped:
        raise ValueError("Choose a reviewed --set-spec, or pass --allow-unscoped explicitly.")
    reviewed_scope = reviewed_source_scope(endpoint, args.set_spec)
    endpoint_registration = official_endpoint_registration(endpoint)
    if args.set_spec and not reviewed_scope and not args.allow_unreviewed_set:
        raise ValueError(
            "The endpoint/set pair is not in pipeline/tci_source_allowlist.json. "
            "Review it first, or pass --allow-unreviewed-set explicitly."
        )
    if reviewed_scope and args.discipline not in ("unknown", reviewed_scope):
        raise ValueError(
            f"Allowlist scope is {reviewed_scope}; --discipline {args.discipline} would create schema drift."
        )

    if args.all_reviewed:
        reviewed_sets = reviewed_source_sets(endpoint)
        if not reviewed_sets:
            raise ValueError("No reviewed sets exist for this endpoint.")
        records_by_id: dict[str, dict[str, Any]] = {}
        for index, reviewed_set in enumerate(reviewed_sets):
            if index:
                time.sleep(args.delay_seconds)
            set_records = list(
                harvest(
                    endpoint=endpoint,
                    set_spec=reviewed_set["set_spec"],
                    date_from=args.date_from,
                    date_until=args.date_until,
                    max_records=args.max_records,
                    delay_seconds=args.delay_seconds,
                    timeout_seconds=args.timeout_seconds,
                )
            )
            for record in set_records:
                record["discipline"] = reviewed_set["scope"]
                prior = records_by_id.get(record["provider_record_id"])
                if prior and prior.get("discipline") != record["discipline"]:
                    record["discipline"] = "unknown"
                records_by_id[record["provider_record_id"]] = record
            print(
                f"Reviewed set {index + 1}/{len(reviewed_sets)}: "
                f"{reviewed_set['label']} ({len(set_records)} records)"
            )
        records = list(records_by_id.values())
        applied_set = f"reviewed:{len(reviewed_sets)}"
    else:
        records = deduplicate_catalog_records(
            harvest(
                endpoint=endpoint,
                set_spec=args.set_spec,
                date_from=args.date_from,
                date_until=args.date_until,
                max_records=args.max_records,
                delay_seconds=args.delay_seconds,
                timeout_seconds=args.timeout_seconds,
            )
        )
        for record in records:
            if reviewed_scope:
                record["discipline"] = reviewed_scope
            elif args.discipline != "unknown":
                record["discipline"] = args.discipline
            elif endpoint_registration:
                apply_endpoint_discipline(record, endpoint_registration)
            else:
                record["discipline"] = "unknown"
        applied_set = args.set_spec
    records = catalog_eligible_records(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )
    if args.apply:
        apply_catalog(records, endpoint=endpoint, set_spec=applied_set)
    print(f"TCI/ThaiJO metadata records: {len(records)}")
    print(f"Output: {args.output}")
    print(f"Applied to catalog: {args.apply}")
    print("Full-text downloads: 0")


if __name__ == "__main__":
    main()
