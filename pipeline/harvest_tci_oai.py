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
OAI_NS = "http://www.openarchives.org/OAI/2.0/"
OAI_DC_NS = "http://www.openarchives.org/OAI/2.0/oai_dc/"
DC_NS = "http://purl.org/dc/elements/1.1/"
NS = {"oai": OAI_NS, "oai_dc": OAI_DC_NS, "dc": DC_NS}
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?\b")


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


def canonical_record(endpoint: str, record: ET.Element) -> dict[str, Any] | None:
    header = record.find("oai:header", NS)
    if header is None or header.get("status") == "deleted":
        return None
    provider_record_id = (header.findtext("oai:identifier", default="", namespaces=NS) or "").strip()
    if not provider_record_id:
        return None
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
    return {
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


def parse_list_records(endpoint: str, xml_payload: bytes | str) -> tuple[list[dict[str, Any]], str | None]:
    root = ET.fromstring(xml_payload)
    error = root.find("oai:error", NS)
    if error is not None:
        code = error.get("code", "unknown")
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
    root = ET.fromstring(xml_payload)
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


def apply_catalog(records: list[dict[str, Any]]) -> None:
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for --apply.")
    client = create_client(url, service_key)
    for offset in range(0, len(records), 200):
        client.table("civil_source_catalog").upsert(
            records[offset : offset + 200],
            on_conflict="provider,provider_record_id",
        ).execute()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Harvest bounded ThaiJO OAI metadata into CivilMCP.")
    parser.add_argument("--endpoint", required=True, help="Official ThaiJO OAI endpoint, without query string.")
    parser.add_argument("--set-spec")
    parser.add_argument(
        "--discipline",
        choices=[
            "unknown",
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
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--until", dest="date_until")
    parser.add_argument("--max-records", type=int, default=100)
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=6.2,
        help="Delay between requests. Default stays below ThaiJO's published 10 requests/minute limit.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=30)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apply", action="store_true", help="Upsert metadata into civil_source_catalog.")
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
    if args.list_sets:
        for set_spec, set_name in parse_list_sets(
            request_xml(endpoint, {"verb": "ListSets"}, args.timeout_seconds)
        ):
            print(f"{set_spec}\t{set_name}")
        return
    if not args.set_spec and not args.allow_unscoped:
        raise ValueError("Choose a reviewed --set-spec, or pass --allow-unscoped explicitly.")

    records = list(
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
        record["discipline"] = args.discipline
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )
    if args.apply:
        apply_catalog(records)
    print(f"TCI/ThaiJO metadata records: {len(records)}")
    print(f"Output: {args.output}")
    print(f"Applied to catalog: {args.apply}")
    print("Full-text downloads: 0")


if __name__ == "__main__":
    main()
