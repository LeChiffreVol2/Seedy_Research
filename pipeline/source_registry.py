"""Canonical source identities and ingestion policy for CivilMCP."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceSpec:
    provider: str
    collection: str
    label: str
    ingestion_mode: str
    default_rights_status: str


SOURCES = {
    "student_transport_projects": SourceSpec(
        provider="student_transport_projects",
        # Legacy storage ID retained for deployed API compatibility.
        collection="ce_project",
        label="Student Transport Projects",
        ingestion_mode="local_full_text",
        default_rights_status="public_source_no_redistribution",
    ),
    "ncce": SourceSpec(
        provider="ncce",
        collection="ncce",
        label="NCCE Proceedings",
        ingestion_mode="local_full_text",
        default_rights_status="public_source_no_redistribution",
    ),
    "tci_thaijo": SourceSpec(
        provider="tci_thaijo",
        collection="tci_journal",
        label="TCI / ThaiJO Journals",
        ingestion_mode="metadata_first",
        default_rights_status="metadata_only_unverified",
    ),
}


def source_spec(provider: str) -> SourceSpec:
    try:
        return SOURCES[provider]
    except KeyError as exc:
        raise ValueError(f"Unknown source provider: {provider}") from exc
