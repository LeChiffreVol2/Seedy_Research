# CivilMCP Data Expansion

## Product boundary

CivilMCP is a Thai research evidence network, not a folder of PDFs. Every source
enters one of two layers:

1. **Source catalog** — metadata for discovery, deduplication, rights review,
   source health, and future promotion.
2. **Evidence index** — rights-reviewed full text with stable document identity,
   original page provenance, quality-cleared sections/chunks, and embeddings.

Search may show catalog-only records, but chat and automated research may cite
only evidence-index records.

## Provider rollout

| Provider | Initial mode | Production promotion gate |
| --- | --- | --- |
| Student Transport Projects | Page-preserving hybrid OCR | PDF page parity, non-empty evidence, verified title, exact-page audit |
| NCCE25/26/29 | Indexed evidence | Existing quality gates |
| NCCE31 | Indexed evidence: 356 papers | Passed paper boundary/duplicate, discipline/title, page, embedding, and strict data-quality gates on 24 July 2026 |
| TCI / ThaiJO | Official OAI metadata only | Article/journal license or permission, stable URL, lawful full-text access, page mapping, OCR/text quality |

The initial ThaiJO allowlist is intentionally narrow: research/case/technical
sets from Geotechnical Engineering Journal and the Journal of Thailand Concrete
Association. Broad endpoint harvesting is opt-in because ThaiJO endpoint
families contain mixed disciplines.

Production snapshot, 13 August 2026: the reviewed allowlist contributes 780
metadata-only records (689 geotechnical and 91 structural/concrete), with 780
publisher links and 682 normalized DOI values. Missing titles and accidental
evidence promotions are both zero. These are discovery coverage metrics, not a
claim of full-text rights or citation coverage.

## Ingestion state machine

```text
discovered
  -> metadata_only
  -> rights_verified
  -> extracted
  -> quality_reviewed
  -> indexed
  -> monitored
  -> removed (provider tombstone or reviewed takedown)
```

Any record may move to `quarantined` or `removed`. Catalog metadata remains
separate so takedown does not require deleting unrelated evidence. ThaiJO OAI
deleted-record headers are retained as default-deny tombstones; apply marks the
matching catalog row `removed`, preserves prior rights decisions and document
linkage, and records the provider identifier/datestamp in provenance. A repeat
apply is idempotent, and restoration after a provider deletion requires review.

## Release gates per provider

- deterministic provider and record IDs;
- DOI/source URL/version deduplication;
- license and access status recorded;
- source timestamp and content hash recorded;
- original page numbers preserved;
- no empty or weak evidence promoted;
- titles, disciplines, language, author, and institution normalized;
- embedding job count and estimated cost reviewed before apply;
- resumable embedding parts and adaptive database upsert sizing for large runs;
- retrieval/citation eval sliced by provider and language;
- source-health, failure, stale-record, and takedown observability.

## Compatibility

`ce_project` remains the internal collection ID until API consumers and saved
sessions support aliases. The product label is `Student Transport Projects`;
new scale logic uses `source_provider`, not collection renames.
