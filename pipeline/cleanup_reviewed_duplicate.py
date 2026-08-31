"""Remove one reviewed duplicate from the live evidence index, safely and audibly.

The command is dry-run by default. ``--apply`` updates the exact catalog row
before deleting the exact duplicate document; section and chunk rows cascade
from the document foreign keys. The canonical document is never mutated.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False

from evidence_exclusions import (
    DEFAULT_EVIDENCE_EXCLUSIONS_PATH,
    EvidenceExclusionManifest,
    ReviewedEvidenceExclusion,
    load_evidence_exclusion_manifest,
)


ROOT_DIR = Path(__file__).resolve().parents[1]
EXPECTED_EXCLUDED_SOURCE = "NCCE31_CEM-49.md"
EXPECTED_PROVIDER = "ncce"
AUDIT_KEY = "reviewed_duplicate_exclusion"


def _one_or_none(rows: Any, label: str) -> dict[str, Any] | None:
    if rows is None:
        return None
    if not isinstance(rows, list):
        raise RuntimeError(f"Unexpected {label} query payload: expected a list.")
    if len(rows) > 1:
        raise RuntimeError(f"Unsafe {label} state: expected at most one exact row, got {len(rows)}.")
    return rows[0] if rows else None


def _exact_mutation_row(response: Any, label: str) -> dict[str, Any]:
    rows = getattr(response, "data", None)
    count = getattr(response, "count", None)
    if not isinstance(rows, list) or count != 1 or len(rows) != 1:
        raise RuntimeError(
            f"Unsafe {label} response: expected count=1 and one returned row; "
            f"got count={count!r}, rows={len(rows) if isinstance(rows, list) else 'invalid'}."
        )
    if not isinstance(rows[0], dict):
        raise RuntimeError(f"Unsafe {label} response: returned row is not an object.")
    return rows[0]


def fetch_document(client: Any, document_id: str) -> dict[str, Any] | None:
    response = (
        client.table("civil_documents_v2")
        .select("id,source,paper_code")
        .eq("id", document_id)
        .limit(2)
        .execute()
    )
    return _one_or_none(response.data, f"document {document_id}")


def fetch_catalog_record(client: Any, document_id: str) -> dict[str, Any] | None:
    catalog_id = f"{EXPECTED_PROVIDER}:{document_id}"
    response = (
        client.table("civil_source_catalog")
        .select("id,provider,provider_record_id,document_id,evidence_status,raw_metadata")
        .eq("id", catalog_id)
        .eq("provider", EXPECTED_PROVIDER)
        .eq("provider_record_id", document_id)
        .limit(2)
        .execute()
    )
    return _one_or_none(response.data, f"catalog record {catalog_id}")


def _audit_core(
    manifest: EvidenceExclusionManifest,
    exclusion: ReviewedEvidenceExclusion,
) -> dict[str, Any]:
    return {
        "manifest_version": manifest.version,
        "excluded_source": exclusion.source,
        "excluded_document_id": exclusion.document_id,
        "canonical_source": exclusion.canonical_source,
        "canonical_document_id": exclusion.canonical_document_id,
        "reason": exclusion.reason,
        "reviewed_by": exclusion.reviewed_by,
        "reviewed_at": exclusion.reviewed_at,
        "body_similarity": exclusion.body_similarity,
        "evidence": list(exclusion.evidence),
    }


def _audit_matches(
    raw_metadata: Any,
    manifest: EvidenceExclusionManifest,
    exclusion: ReviewedEvidenceExclusion,
) -> bool:
    if not isinstance(raw_metadata, dict):
        return False
    audit = raw_metadata.get(AUDIT_KEY)
    if not isinstance(audit, dict):
        return False
    return all(audit.get(key) == value for key, value in _audit_core(manifest, exclusion).items())


def validate_cleanup_state(
    *,
    manifest: EvidenceExclusionManifest,
    exclusion: ReviewedEvidenceExclusion,
    canonical_document: dict[str, Any] | None,
    duplicate_document: dict[str, Any] | None,
    canonical_catalog: dict[str, Any] | None,
    duplicate_catalog: dict[str, Any] | None,
) -> str:
    """Return ``ready`` or ``already_applied``; reject every ambiguous state."""

    if exclusion.source != EXPECTED_EXCLUDED_SOURCE:
        raise RuntimeError(
            f"This cleanup is restricted to {EXPECTED_EXCLUDED_SOURCE}; got {exclusion.source}."
        )
    if canonical_document is None:
        raise RuntimeError(
            f"Canonical document is missing; refusing cleanup: {exclusion.canonical_document_id}."
        )
    if canonical_document.get("id") != exclusion.canonical_document_id:
        raise RuntimeError("Canonical document ID did not match the reviewed manifest.")
    if canonical_document.get("source") != exclusion.canonical_source:
        raise RuntimeError(
            "Canonical document source mismatch: "
            f"expected {exclusion.canonical_source}, got {canonical_document.get('source')!r}."
        )
    if canonical_catalog is None:
        raise RuntimeError("Canonical catalog record is missing; refusing cleanup.")
    if (
        canonical_catalog.get("id") != f"{EXPECTED_PROVIDER}:{exclusion.canonical_document_id}"
        or canonical_catalog.get("provider") != EXPECTED_PROVIDER
        or canonical_catalog.get("provider_record_id") != exclusion.canonical_document_id
        or canonical_catalog.get("document_id") != exclusion.canonical_document_id
        or canonical_catalog.get("evidence_status") != "indexed"
    ):
        raise RuntimeError("Canonical catalog IDs/status do not match the retained evidence document.")

    if duplicate_catalog is None:
        raise RuntimeError("Exact duplicate catalog record is missing; refusing cleanup.")
    if (
        duplicate_catalog.get("id") != f"{EXPECTED_PROVIDER}:{exclusion.document_id}"
        or duplicate_catalog.get("provider") != EXPECTED_PROVIDER
        or duplicate_catalog.get("provider_record_id") != exclusion.document_id
    ):
        raise RuntimeError("Duplicate catalog source/IDs do not match the reviewed manifest.")
    raw_metadata = duplicate_catalog.get("raw_metadata")
    if not isinstance(raw_metadata, dict) or raw_metadata.get("source") != exclusion.source:
        raise RuntimeError(
            "Duplicate catalog raw_metadata.source does not exactly match the reviewed source."
        )

    if duplicate_document is None:
        if (
            duplicate_catalog.get("evidence_status") == "removed"
            and duplicate_catalog.get("document_id") is None
            and _audit_matches(raw_metadata, manifest, exclusion)
        ):
            return "already_applied"
        raise RuntimeError(
            "Duplicate document is absent, but its catalog tombstone is incomplete or unaudited."
        )

    if duplicate_document.get("id") != exclusion.document_id:
        raise RuntimeError("Duplicate document ID did not match the reviewed manifest.")
    if duplicate_document.get("source") != exclusion.source:
        raise RuntimeError(
            "Duplicate document source mismatch: "
            f"expected {exclusion.source}, got {duplicate_document.get('source')!r}."
        )
    if duplicate_catalog.get("document_id") != exclusion.document_id:
        raise RuntimeError("Duplicate catalog document_id does not point to the exact duplicate.")
    return "ready"


def fetch_cleanup_state(
    client: Any,
    exclusion: ReviewedEvidenceExclusion,
) -> dict[str, dict[str, Any] | None]:
    return {
        "canonical_document": fetch_document(client, exclusion.canonical_document_id),
        "duplicate_document": fetch_document(client, exclusion.document_id),
        "canonical_catalog": fetch_catalog_record(client, exclusion.canonical_document_id),
        "duplicate_catalog": fetch_catalog_record(client, exclusion.document_id),
    }


def child_counts(client: Any, document_id: str) -> tuple[int, int]:
    section_response = (
        client.table("civil_sections_v2")
        .select("id", count="exact")
        .eq("document_id", document_id)
        .execute()
    )
    chunk_response = (
        client.table("civil_chunks_v2")
        .select("id", count="exact")
        .eq("document_id", document_id)
        .execute()
    )
    return int(section_response.count or 0), int(chunk_response.count or 0)


def run_cleanup(client: Any, *, apply: bool) -> str:
    manifest = load_evidence_exclusion_manifest(DEFAULT_EVIDENCE_EXCLUSIONS_PATH)
    exclusion = manifest.by_source.get(EXPECTED_EXCLUDED_SOURCE)
    if exclusion is None:
        raise RuntimeError(
            f"Reviewed manifest does not contain the exact cleanup source {EXPECTED_EXCLUDED_SOURCE}."
        )

    state = fetch_cleanup_state(client, exclusion)
    status = validate_cleanup_state(manifest=manifest, exclusion=exclusion, **state)
    sections, chunks = child_counts(client, exclusion.document_id)
    print(f"Reviewed duplicate     : {exclusion.source} ({exclusion.document_id})")
    print(f"Canonical retained     : {exclusion.canonical_source} ({exclusion.canonical_document_id})")
    print(f"Dependent rows         : sections={sections}, chunks={chunks}")
    print(f"Current cleanup state  : {status}")

    if status == "already_applied":
        print("No action needed; the exact reviewed tombstone is already applied.")
        return status
    if not apply:
        print("Dry run complete; pass --apply to update the exact catalog row and delete the exact duplicate document.")
        return status

    duplicate_catalog = state["duplicate_catalog"]
    if duplicate_catalog is None:  # guarded by validate_cleanup_state
        raise RuntimeError("Duplicate catalog record disappeared before apply.")
    raw_metadata = dict(duplicate_catalog.get("raw_metadata") or {})
    audit = _audit_core(manifest, exclusion)
    audit["cleanup_applied_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    raw_metadata[AUDIT_KEY] = audit
    updated_at = dt.datetime.now(dt.timezone.utc).isoformat()

    # The audit tombstone is written first so a failed delete never loses the
    # review decision. A retry can safely complete the exact document delete.
    update_response = (
        client.table("civil_source_catalog")
        .update(
            {
                "evidence_status": "removed",
                "raw_metadata": raw_metadata,
                "updated_at": updated_at,
            },
            count="exact",
        )
        .eq("id", f"{EXPECTED_PROVIDER}:{exclusion.document_id}")
        .eq("provider", EXPECTED_PROVIDER)
        .eq("provider_record_id", exclusion.document_id)
        .execute()
    )
    updated_row = _exact_mutation_row(update_response, "catalog tombstone update")
    if updated_row.get("id") != f"{EXPECTED_PROVIDER}:{exclusion.document_id}":
        raise RuntimeError("Catalog tombstone update returned an unexpected record ID.")

    # Verify the durable audit before the destructive step. A zero-row update,
    # stale filter, or malformed response cannot proceed to document deletion.
    tombstoned_catalog = fetch_catalog_record(client, exclusion.document_id)
    if (
        tombstoned_catalog is None
        or tombstoned_catalog.get("evidence_status") != "removed"
        or tombstoned_catalog.get("document_id") != exclusion.document_id
        or not _audit_matches(tombstoned_catalog.get("raw_metadata"), manifest, exclusion)
    ):
        raise RuntimeError("Catalog tombstone audit verification failed; duplicate document was not deleted.")

    delete_response = (
        client.table("civil_documents_v2")
        .delete(count="exact")
        .eq("id", exclusion.document_id)
        .eq("source", exclusion.source)
        .execute()
    )
    try:
        deleted_row = _exact_mutation_row(delete_response, "duplicate document delete")
    except RuntimeError:
        # A concurrent identical cleanup is acceptable only if the complete,
        # exact tombstone state now validates as already applied.
        concurrent_state = fetch_cleanup_state(client, exclusion)
        concurrent_status = validate_cleanup_state(
            manifest=manifest,
            exclusion=exclusion,
            **concurrent_state,
        )
        if concurrent_status == "already_applied":
            print("Cleanup was already applied concurrently and verified.")
            return concurrent_status
        raise
    if (
        deleted_row.get("id") != exclusion.document_id
        or deleted_row.get("source") != exclusion.source
    ):
        raise RuntimeError("Duplicate delete returned a row outside the exact reviewed source/ID.")

    verified_state = fetch_cleanup_state(client, exclusion)
    verified_status = validate_cleanup_state(
        manifest=manifest,
        exclusion=exclusion,
        **verified_state,
    )
    if verified_status != "already_applied":
        raise RuntimeError("Cleanup verification failed after the exact delete.")
    print("Cleanup applied and verified; canonical evidence remains indexed.")
    return verified_status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dry-run or apply the reviewed NCCE31_CEM-49 duplicate cleanup."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the exact catalog tombstone and delete only the exact duplicate document.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for validated dry-run/apply.")

    from supabase import create_client

    client = create_client(url, service_key)
    run_cleanup(client, apply=args.apply)


if __name__ == "__main__":
    main()
