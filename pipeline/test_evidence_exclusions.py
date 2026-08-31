from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from cleanup_reviewed_duplicate import (
    AUDIT_KEY,
    _audit_core,
    _exact_mutation_row,
    validate_cleanup_state,
)
from evidence_exclusions import (
    EvidenceExclusionError,
    load_evidence_exclusion_manifest,
    select_index_sources,
)


def manifest_payload(*, similarity: float = 0.9988) -> dict[str, object]:
    return {
        "manifest_version": 1,
        "exclusions": [
            {
                "source": "NCCE31_CEM-49.md",
                "document_id": "NCCE31_CEM-49",
                "canonical_source": "NCCE31_TRL-26.md",
                "canonical_document_id": "NCCE31_TRL-26",
                "reason": "Reviewed duplicate proceedings occurrence retained under transport.",
                "reviewed_by": "Corpus QA",
                "reviewed_at": "2026-08-31",
                "body_similarity": similarity,
                "evidence": ["Same normalized title.", "Same normalized body."],
            }
        ],
    }


def write_manifest(root: Path, payload: dict[str, object] | None = None) -> Path:
    path = root / "evidence_exclusions.json"
    path.write_text(json.dumps(payload or manifest_payload()), encoding="utf-8")
    return path


class EvidenceExclusionPolicyTests(unittest.TestCase):
    def test_index_selection_excludes_reviewed_source_and_keeps_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            duplicate = root / "NCCE31_CEM-49.md"
            canonical = root / "NCCE31_TRL-26.md"
            duplicate.touch()
            canonical.touch()
            manifest = load_evidence_exclusion_manifest(write_manifest(root))

            selection = select_index_sources([duplicate, canonical], (), manifest)

        self.assertEqual([path.name for path in selection.eligible_files], [canonical.name])
        self.assertEqual(
            [item.source for item in selection.reviewed_exclusions],
            [duplicate.name],
        )

    def test_index_selection_rejects_explicit_scope_containing_only_exclusion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            duplicate = root / "NCCE31_CEM-49.md"
            canonical = root / "NCCE31_TRL-26.md"
            duplicate.touch()
            canonical.touch()
            manifest = load_evidence_exclusion_manifest(write_manifest(root))

            with self.assertRaisesRegex(
                EvidenceExclusionError,
                "matched only reviewed duplicate exclusions",
            ):
                select_index_sources([duplicate, canonical], [duplicate.name], manifest)

    def test_manifest_rejects_similarity_below_review_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_manifest(root, manifest_payload(similarity=0.5))

            with self.assertRaisesRegex(EvidenceExclusionError, "body_similarity"):
                load_evidence_exclusion_manifest(manifest_path)


class ReviewedDuplicateCleanupStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.manifest = load_evidence_exclusion_manifest(write_manifest(self.root))
        self.exclusion = self.manifest.exclusions[0]
        self.canonical_document = {
            "id": "NCCE31_TRL-26",
            "source": "NCCE31_TRL-26.md",
            "paper_code": "TRL-26",
        }
        self.duplicate_document = {
            "id": "NCCE31_CEM-49",
            "source": "NCCE31_CEM-49.md",
            "paper_code": "CEM-49",
        }
        self.canonical_catalog = {
            "id": "ncce:NCCE31_TRL-26",
            "provider": "ncce",
            "provider_record_id": "NCCE31_TRL-26",
            "document_id": "NCCE31_TRL-26",
            "evidence_status": "indexed",
            "raw_metadata": {"source": "NCCE31_TRL-26.md"},
        }
        self.duplicate_catalog = {
            "id": "ncce:NCCE31_CEM-49",
            "provider": "ncce",
            "provider_record_id": "NCCE31_CEM-49",
            "document_id": "NCCE31_CEM-49",
            "evidence_status": "indexed",
            "raw_metadata": {"source": "NCCE31_CEM-49.md"},
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def state(self, **overrides: object) -> str:
        values: dict[str, object] = {
            "canonical_document": self.canonical_document,
            "duplicate_document": self.duplicate_document,
            "canonical_catalog": self.canonical_catalog,
            "duplicate_catalog": self.duplicate_catalog,
        }
        values.update(overrides)
        return validate_cleanup_state(
            manifest=self.manifest,
            exclusion=self.exclusion,
            **values,  # type: ignore[arg-type]
        )

    def test_ready_state_requires_exact_ids_and_sources(self) -> None:
        self.assertEqual(self.state(), "ready")
        bad_canonical = {**self.canonical_document, "source": "wrong.md"}
        with self.assertRaisesRegex(RuntimeError, "Canonical document source mismatch"):
            self.state(canonical_document=bad_canonical)

    def test_already_applied_state_is_idempotent_only_with_matching_audit(self) -> None:
        audit = _audit_core(self.manifest, self.exclusion)
        audit["cleanup_applied_at"] = "2026-08-31T00:00:00+00:00"
        removed_catalog = {
            **self.duplicate_catalog,
            "document_id": None,
            "evidence_status": "removed",
            "raw_metadata": {
                "source": "NCCE31_CEM-49.md",
                AUDIT_KEY: audit,
            },
        }

        self.assertEqual(
            self.state(duplicate_document=None, duplicate_catalog=removed_catalog),
            "already_applied",
        )

    def test_mutation_response_must_affect_exactly_one_row(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "expected count=1"):
            _exact_mutation_row(SimpleNamespace(count=0, data=[]), "catalog update")
        row = {"id": "ncce:NCCE31_CEM-49"}
        self.assertEqual(
            _exact_mutation_row(SimpleNamespace(count=1, data=[row]), "catalog update"),
            row,
        )


if __name__ == "__main__":
    unittest.main()
