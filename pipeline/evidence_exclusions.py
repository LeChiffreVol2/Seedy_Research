"""Validated, index-enforced exclusions for reviewed duplicate evidence."""

from __future__ import annotations

import datetime as dt
import fnmatch
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_EVIDENCE_EXCLUSIONS_PATH = PIPELINE_DIR / "evidence_exclusions.json"
SUPPORTED_MANIFEST_VERSION = 1
MIN_REVIEWED_BODY_SIMILARITY = 0.98


class EvidenceExclusionError(ValueError):
    """Raised when the exclusion manifest or its corpus relationship is invalid."""


@dataclass(frozen=True)
class ReviewedEvidenceExclusion:
    source: str
    document_id: str
    canonical_source: str
    canonical_document_id: str
    reason: str
    reviewed_by: str
    reviewed_at: str
    body_similarity: float
    evidence: tuple[str, ...]

    def summary(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "documentId": self.document_id,
            "canonicalSource": self.canonical_source,
            "canonicalDocumentId": self.canonical_document_id,
            "reason": self.reason,
            "reviewedBy": self.reviewed_by,
            "reviewedAt": self.reviewed_at,
            "bodySimilarity": self.body_similarity,
        }


@dataclass(frozen=True)
class EvidenceExclusionManifest:
    version: int
    exclusions: tuple[ReviewedEvidenceExclusion, ...]

    @property
    def by_source(self) -> dict[str, ReviewedEvidenceExclusion]:
        return {item.source: item for item in self.exclusions}


@dataclass(frozen=True)
class IndexSourceSelection:
    matched_files: tuple[Path, ...]
    eligible_files: tuple[Path, ...]
    reviewed_exclusions: tuple[ReviewedEvidenceExclusion, ...]


def _required_text(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EvidenceExclusionError(f"{context}.{key} must be a non-empty string.")
    return value.strip()


def _source_name(payload: dict[str, Any], key: str, context: str) -> str:
    value = _required_text(payload, key, context)
    if Path(value).name != value or not value.endswith(".md"):
        raise EvidenceExclusionError(
            f"{context}.{key} must be a markdown basename without directories: {value!r}."
        )
    return value


def _reviewed_date(payload: dict[str, Any], context: str) -> str:
    value = _required_text(payload, "reviewed_at", context)
    try:
        dt.date.fromisoformat(value)
    except ValueError as exc:
        raise EvidenceExclusionError(
            f"{context}.reviewed_at must be an ISO date (YYYY-MM-DD): {value!r}."
        ) from exc
    return value


def _parse_exclusion(payload: Any, index: int) -> ReviewedEvidenceExclusion:
    context = f"exclusions[{index}]"
    if not isinstance(payload, dict):
        raise EvidenceExclusionError(f"{context} must be an object.")

    source = _source_name(payload, "source", context)
    document_id = _required_text(payload, "document_id", context)
    canonical_source = _source_name(payload, "canonical_source", context)
    canonical_document_id = _required_text(payload, "canonical_document_id", context)
    reason = _required_text(payload, "reason", context)
    reviewed_by = _required_text(payload, "reviewed_by", context)
    reviewed_at = _reviewed_date(payload, context)

    if document_id != Path(source).stem:
        raise EvidenceExclusionError(
            f"{context}.document_id must equal the excluded source stem ({Path(source).stem!r})."
        )
    if canonical_document_id != Path(canonical_source).stem:
        raise EvidenceExclusionError(
            f"{context}.canonical_document_id must equal the canonical source stem "
            f"({Path(canonical_source).stem!r})."
        )
    if source == canonical_source or document_id == canonical_document_id:
        raise EvidenceExclusionError(f"{context} cannot exclude a source in favor of itself.")
    if len(reason) < 20:
        raise EvidenceExclusionError(f"{context}.reason must contain a review rationale.")

    similarity = payload.get("body_similarity")
    if isinstance(similarity, bool) or not isinstance(similarity, (int, float)):
        raise EvidenceExclusionError(f"{context}.body_similarity must be a number.")
    body_similarity = float(similarity)
    if not MIN_REVIEWED_BODY_SIMILARITY <= body_similarity <= 1.0:
        raise EvidenceExclusionError(
            f"{context}.body_similarity must be between "
            f"{MIN_REVIEWED_BODY_SIMILARITY} and 1.0."
        )

    evidence_payload = payload.get("evidence")
    if not isinstance(evidence_payload, list) or not evidence_payload:
        raise EvidenceExclusionError(f"{context}.evidence must be a non-empty list.")
    evidence = tuple(
        item.strip()
        for item in evidence_payload
        if isinstance(item, str) and item.strip()
    )
    if len(evidence) != len(evidence_payload):
        raise EvidenceExclusionError(
            f"{context}.evidence entries must all be non-empty strings."
        )

    return ReviewedEvidenceExclusion(
        source=source,
        document_id=document_id,
        canonical_source=canonical_source,
        canonical_document_id=canonical_document_id,
        reason=reason,
        reviewed_by=reviewed_by,
        reviewed_at=reviewed_at,
        body_similarity=body_similarity,
        evidence=evidence,
    )


def load_evidence_exclusion_manifest(
    path: Path = DEFAULT_EVIDENCE_EXCLUSIONS_PATH,
) -> EvidenceExclusionManifest:
    if not path.exists():
        raise EvidenceExclusionError(f"Evidence exclusion manifest not found: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvidenceExclusionError(f"Invalid JSON in evidence exclusion manifest {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise EvidenceExclusionError("Evidence exclusion manifest must be a JSON object.")
    version = payload.get("manifest_version")
    if version != SUPPORTED_MANIFEST_VERSION:
        raise EvidenceExclusionError(
            f"Unsupported evidence exclusion manifest_version={version!r}; "
            f"expected {SUPPORTED_MANIFEST_VERSION}."
        )
    raw_exclusions = payload.get("exclusions")
    if not isinstance(raw_exclusions, list):
        raise EvidenceExclusionError("Evidence exclusion manifest.exclusions must be a list.")

    exclusions = tuple(_parse_exclusion(item, index) for index, item in enumerate(raw_exclusions))
    sources = [item.source for item in exclusions]
    document_ids = [item.document_id for item in exclusions]
    if len(sources) != len(set(sources)):
        raise EvidenceExclusionError("Evidence exclusion sources must be unique.")
    if len(document_ids) != len(set(document_ids)):
        raise EvidenceExclusionError("Evidence exclusion document_ids must be unique.")
    excluded_sources = set(sources)
    for item in exclusions:
        if item.canonical_source in excluded_sources:
            raise EvidenceExclusionError(
                f"Canonical source cannot itself be excluded: {item.canonical_source}."
            )
    return EvidenceExclusionManifest(version=version, exclusions=exclusions)


def validate_manifest_against_corpus(
    manifest: EvidenceExclusionManifest,
    files: Iterable[Path],
) -> tuple[ReviewedEvidenceExclusion, ...]:
    """Validate exclusions relevant to this corpus and return them deterministically."""

    files_by_name: dict[str, Path] = {}
    for path in files:
        if path.name in files_by_name:
            raise EvidenceExclusionError(f"Duplicate markdown basename in corpus: {path.name}.")
        files_by_name[path.name] = path

    relevant: list[ReviewedEvidenceExclusion] = []
    for item in manifest.exclusions:
        has_excluded = item.source in files_by_name
        has_canonical = item.canonical_source in files_by_name
        if not has_excluded and not has_canonical:
            continue
        if not has_excluded or not has_canonical:
            missing = item.source if not has_excluded else item.canonical_source
            raise EvidenceExclusionError(
                f"Reviewed exclusion {item.source} -> {item.canonical_source} is incomplete; "
                f"missing corpus file {missing}."
            )
        relevant.append(item)
    return tuple(sorted(relevant, key=lambda item: item.source))


def select_index_sources(
    files: Iterable[Path],
    source_globs: Iterable[str],
    manifest: EvidenceExclusionManifest,
) -> IndexSourceSelection:
    """Apply source globs and reviewed exclusions using the indexer's exact policy."""

    all_files = tuple(sorted(files, key=lambda path: path.name))
    relevant = validate_manifest_against_corpus(manifest, all_files)
    patterns = tuple(source_globs)
    matched = tuple(
        path
        for path in all_files
        if not patterns or any(fnmatch.fnmatch(path.name, pattern) for pattern in patterns)
    )
    if not matched:
        scope = ", ".join(patterns) if patterns else "all markdown sources"
        raise EvidenceExclusionError(f"No markdown files matched source scope: {scope}.")

    exclusions_by_source = {item.source: item for item in relevant}
    reviewed = tuple(
        exclusions_by_source[path.name]
        for path in matched
        if path.name in exclusions_by_source
    )
    eligible = tuple(path for path in matched if path.name not in exclusions_by_source)
    if not eligible:
        if reviewed:
            mappings = ", ".join(
                f"{item.source} -> {item.canonical_source}" for item in reviewed
            )
            raise EvidenceExclusionError(
                "Source scope matched only reviewed duplicate exclusions; "
                f"nothing is index-eligible ({mappings}). Index the canonical source instead."
            )
        raise EvidenceExclusionError("No index-eligible markdown files were selected.")
    return IndexSourceSelection(
        matched_files=matched,
        eligible_files=eligible,
        reviewed_exclusions=reviewed,
    )
