from __future__ import annotations

import unittest

from pipeline.audit_openalex_visibility import (
    METHOD_VERSION,
    OpenAlexClient,
    audit_key,
    classify_lookup,
    normalize_doi,
)


class OpenAlexVisibilityAuditTests(unittest.TestCase):
    def test_normalize_doi_removes_resolver_prefix(self) -> None:
        self.assertEqual(normalize_doi("https://doi.org/10.1234/ABC.1"), "10.1234/abc.1")
        self.assertIsNone(normalize_doi("not-a-doi"))

    def test_exact_doi_can_be_under_indexed_without_losing_identity(self) -> None:
        record = {
            "id": "catalog-1",
            "provider": "tci_thaijo",
            "provider_record_id": "oai:thai:1",
            "title_local": "การศึกษาความปลอดภัยทางถนน",
            "title_en": "Road safety in Thailand",
            "abstract_local": "บทคัดย่อที่มีอยู่ในแหล่งไทย",
            "doi": "10.1234/road.1",
            "pdf_url": "https://example.org/road.pdf",
            "published_at": "2024-01-01",
            "authors": ["Somchai Researcher"],
        }
        result = classify_lookup(record, {
            "status": "connected",
            "candidates": [{
                "id": "https://openalex.org/W123",
                "doi": "https://doi.org/10.1234/ROAD.1",
                "display_name": "Road safety in Thailand",
                "publication_year": 2024,
                "abstract_inverted_index": None,
                "authorships": [{"author": {"display_name": "Somchai Researcher"}, "institutions": []}],
                "referenced_works": [],
                "open_access": {"oa_url": None},
            }],
        })
        self.assertEqual(result["visibility_state"], "under_indexed")
        self.assertEqual(result["match_basis"], "exact_doi")
        self.assertEqual(result["external_work_id"], "https://openalex.org/W123")
        self.assertFalse(result["requires_human_review"])
        self.assertIn("thai_title_not_represented", result["metadata_gaps"])
        self.assertIn("abstract_missing", result["metadata_gaps"])
        self.assertIn("open_fulltext_location_missing", result["metadata_gaps"])

    def test_title_author_year_match_remains_a_candidate(self) -> None:
        record = {
            "id": "catalog-2",
            "provider": "tci_thaijo",
            "provider_record_id": "oai:thai:2",
            "title_en": "Flood resilience of Thai transport networks",
            "published_at": "2023-01-01",
            "authors": ["Narin Example"],
            "doi": None,
        }
        result = classify_lookup(record, {
            "status": "connected",
            "candidates": [{
                "id": "https://openalex.org/W456",
                "doi": None,
                "display_name": "Flood resilience of Thai transport networks",
                "publication_year": 2023,
                "authorships": [{"author": {"display_name": "Narin Example"}, "institutions": []}],
            }],
        })
        self.assertEqual(result["visibility_state"], "candidate_match")
        self.assertEqual(result["match_basis"], "title_author_year")
        self.assertTrue(result["requires_human_review"])
        self.assertGreaterEqual(result["confidence"], 0.9)

    def test_connected_empty_result_is_scoped_not_found(self) -> None:
        result = classify_lookup({
            "id": "catalog-3",
            "provider": "tci_thaijo",
            "provider_record_id": "oai:thai:3",
            "title_local": "งานวิจัยภาษาไทย",
            "published_at": "2022-01-01",
            "authors": [],
            "doi": None,
        }, {"status": "connected", "candidates": []})
        self.assertEqual(result["visibility_state"], "not_found_in_audit")
        self.assertEqual(result["match_basis"], "none")
        self.assertIsNone(result["external_work_id"])

    def test_provider_failure_never_becomes_not_found(self) -> None:
        result = classify_lookup({
            "id": "catalog-4",
            "provider": "tci_thaijo",
            "provider_record_id": "oai:thai:4",
            "title_en": "A paper",
        }, {"status": "rate_limited", "error_code": "http_429", "candidates": []})
        self.assertEqual(result["visibility_state"], "audit_unavailable")
        self.assertEqual(result["match_basis"], "provider_unavailable")
        self.assertEqual(result["provider_error_code"], "http_429")

    def test_audit_key_is_stable_and_method_versioned(self) -> None:
        key = audit_key("tci_thaijo", "openalex", "2026-09-02", "identifiers")
        self.assertEqual(key, f"tci_thaijo:openalex:2026-09-02:identifiers:{METHOD_VERSION}")

    def test_doi_lookup_uses_singletons_to_avoid_incomplete_filter_index(self) -> None:
        client = OpenAlexClient(api_key="", mailto="", requests_per_second=10)
        endpoints = []

        def fake_fetch(params, endpoint):
            endpoints.append((params, endpoint))
            return {"status": "connected", "payload": {
                "id": "https://openalex.org/W1",
                "doi": "https://doi.org/10.14456/example.1",
            }}

        client._fetch = fake_fetch  # type: ignore[method-assign]
        result = client.lookup_doi_batch([{"doi": "10.14456/example.1"}])
        self.assertEqual(result["10.14456/example.1"]["candidates"][0]["id"], "https://openalex.org/W1")
        self.assertIn("/works/https://doi.org/10.14456/example.1", endpoints[0][1])


if __name__ == "__main__":
    unittest.main()
