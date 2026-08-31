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
        # Legacy provider ID retained for rows already harvested from ThaiJO.
        # TCI is a separate citation index and must not be conflated with the
        # ThaiJO publishing platform.
        label="ThaiJO Journals",
        ingestion_mode="metadata_first",
        default_rights_status="metadata_only_unverified",
    ),
    "tci_citation": SourceSpec(
        provider="tci_citation",
        collection="tci_citation",
        label="TCI Citation Index",
        ingestion_mode="partner_metadata",
        default_rights_status="metadata_only_unverified",
    ),
    "tnrr": SourceSpec(
        provider="tnrr",
        collection="tnrr_output",
        label="Thai National Research Repository (TNRR)",
        ingestion_mode="authenticated_metadata",
        default_rights_status="metadata_only_unverified",
    ),
    "thailis_tdc": SourceSpec(
        provider="thailis_tdc",
        collection="thailis_tdc",
        label="ThaiLIS / TDC",
        ingestion_mode="partner_metadata",
        default_rights_status="restricted",
    ),
    "thai_conference": SourceSpec(
        provider="thai_conference",
        collection="thai_conference",
        label="Thai Conference Proceedings",
        ingestion_mode="registry_metadata",
        default_rights_status="metadata_only_unverified",
    ),
    "thai_ir": SourceSpec(
        provider="thai_ir",
        collection="thai_ir",
        label="Thai Institutional Repositories",
        ingestion_mode="repository_metadata",
        default_rights_status="metadata_only_unverified",
    ),
}


def source_spec(provider: str) -> SourceSpec:
    try:
        return SOURCES[provider]
    except KeyError as exc:
        raise ValueError(f"Unknown source provider: {provider}") from exc
