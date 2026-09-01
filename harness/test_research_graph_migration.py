from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260831120000_civil_research_graph_assets.sql"
COVERAGE_MIGRATION = ROOT / "supabase" / "migrations" / "20260902010000_civil_authoritative_research_coverage.sql"


class ResearchGraphMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.sql.lower()

    def test_is_additive_transaction_and_does_not_backfill(self) -> None:
        self.assertTrue(self.lower.startswith("begin;"))
        self.assertTrue(self.lower.rstrip().endswith("commit;"))
        self.assertIn("add column if not exists work_id", self.lower)
        self.assertNotIn("update public.civil_source_catalog set work_id", self.lower)

    def test_models_identity_coverage_assets_pages_relations_and_annotations(self) -> None:
        for table in (
            "civil_works",
            "civil_source_endpoint_coverage",
            "civil_work_assets",
            "civil_fulltext_pages",
            "civil_work_relations",
            "civil_user_annotation_anchors",
        ):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.lower)
                self.assertIn(f"alter table public.{table} enable row level security", self.lower)

    def test_native_reader_is_asset_rights_gated(self) -> None:
        for marker in (
            "native_fulltext_display",
            "asset_storage",
            "text_extraction",
            "reader_access_mode",
            "rights_verified_at",
            "rights_provenance",
            "content_sha256",
        ):
            self.assertIn(marker, self.lower)
        native_check = self.lower.split("reader_access_mode <> 'native_verified'", 1)[1].split("check (", 1)[0]
        self.assertIn("native_fulltext_display", native_check)
        self.assertIn("rights_verified_at", native_check)

    def test_full_text_is_service_only_and_has_no_public_read_rpc(self) -> None:
        for table in (
            "civil_works",
            "civil_source_endpoint_coverage",
            "civil_work_assets",
            "civil_fulltext_pages",
            "civil_work_relations",
            "civil_user_annotation_anchors",
        ):
            with self.subTest(table=table):
                self.assertIn(
                    f"revoke all on table public.{table} from public, anon, authenticated",
                    self.lower,
                )
                self.assertIn(f"grant all on table public.{table} to service_role", self.lower)
        self.assertNotIn("security definer", self.lower)
        self.assertNotIn("grant select on table public.civil_fulltext_pages", self.lower)
        self.assertNotIn("returns setof public.civil_fulltext_pages", self.lower)

    def test_jsonb_manifests_use_supported_exact_key_checks(self) -> None:
        self.assertNotIn("jsonb_object_length", self.lower)
        self.assertIn("capability_manifest - array[", self.lower)
        self.assertIn("rights_actions - array[", self.lower)


class AuthoritativeCoverageMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.lower = COVERAGE_MIGRATION.read_text(encoding="utf-8").lower()

    def test_coverage_is_derived_from_rights_and_exact_page_cardinality(self) -> None:
        for marker in (
            "civil_research_coverage_v1",
            "p.stored_pages = a.page_count",
            "reader_access_mode = 'native_verified'",
            "native_fulltext_display",
            "content_sha256",
            "rights_verified_at >= a.rights_checked_at",
        ):
            self.assertIn(marker, self.lower)
        self.assertNotIn("endpoint_known", self.lower)

    def test_coverage_rpc_is_server_only_and_facets_count_extracted_evidence(self) -> None:
        self.assertIn("security definer", self.lower)
        self.assertIn("revoke all on function public.civil_research_coverage_v1()", self.lower)
        self.assertIn("grant execute on function public.civil_research_coverage_v1()\nto service_role", self.lower)
        self.assertNotIn("grant execute on function public.civil_research_coverage_v1()\nto anon", self.lower)
        self.assertIn("evidence_status in ('extracted', 'indexed')", self.lower)


if __name__ == "__main__":
    unittest.main()
