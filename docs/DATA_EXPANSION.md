# Seedy Research Data Expansion

## Product boundary

Seedy Research is a Thai research evidence network, not a folder of PDFs. Every source
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
| NCCE31 | Production: 356 papers; staged repair: 358 eligible | Non-contiguous reused-code papers split; one 99.88%-similar duplicate is excluded by the same manifest enforced by QA and the indexer; production refresh awaits explicit embedding/cleanup approval |
| ThaiJO (legacy provider ID `tci_thaijo`) | Official OAI metadata only | Article/asset license or permission, stable URL, lawful full-text access, page mapping, OCR/text quality |
| PMC Thai-affiliated global OA (`pmc_oa`) | 897 version-of-record native papers live | Explicit Thailand author affiliation, exact item/version CC BY, NLM OA status, retraction/manuscript exclusions, S3 MD5 + Seedy SHA-256, PDF/page parity, third-party credit scan |
| TCI Citation Index | Partner metadata/export only | Official agreement, refresh/deletion contract, dedupe against ThaiJO, and publisher-level asset resolution |
| TNRR | Authenticated `ResearchOutput` metadata only | Approved account and terms; `hasfullReport` is not permission; separate asset rights are required |
| ThaiLIS / TDC | Partner metadata and institution-mediated links | Metadata denominator agreement; never proxy member authentication; asset-specific permission for native reading |
| Other Thai conferences / institutional repositories | Provider registry, OAI/export, or organizer deposit | Series/repository denominator, stable identity, explicit asset rights, page and quality gates |

Reviewed civil sources remain set-level allowlisted. The official registry also
pins all 36 ThaiJO endpoint families with exact endpoint provenance and a broad
routing domain. Endpoint-wide harvesting remains an explicit opt-in because one
family can host mixed disciplines; its output is always metadata-only and must
pass ID uniqueness, paper-shape, rights, and completeness gates before apply.

Production snapshot, 31 August 2026: `ph01` contributes 2,380 active records and
the bounded `sc01` pilot contributes 198 net-new active records, for 2,578
ThaiJO-hosted discovery records with 2,578 publisher links and 833 normalized
DOI values. Active missing titles, URLs, authors, and accidental evidence
promotions are zero in the new batch. Forty-four provider-deleted records remain
only as removed audit tombstones: 38 from `ph01` and six added by the `sc01`
pilot. Separately, six `FULL ISSUE` / `ฉบับเต็ม` containers are
excluded from the paper count. These are discovery coverage metrics, not a claim
of Thai affiliation, full-text rights, or citation coverage.

Production snapshot, 2 September 2026: the native reader contains 1,000 papers
and 14,485 pages. The 103-paper Thai-local/ThaiJO proof remains a distinct
coverage class. A separate `pmc_oa` cohort contributes 897 Thai-affiliated
global OA papers and 13,380 pages from NLM's official public Article Datasets.
All 897 records retain explicit Thailand-affiliation evidence and exact
item/version CC BY; this route connects globally published Thai work and does
not fill the still-unmeasured Thai-local provider gap.

For native-reader growth, the dated
[5,000-paper source plan](research/NATIVE_FULL_TEXT_1000_TO_5000_SOURCE_PLAN.md)
and machine-checked `pipeline/cohorts/native_5000_portfolio.json` are the control
plane. The first wave contains 1,685 screening records; it does not contain
1,685 verified assets. ThaiJO's official OAI-PMH service supplies the metadata
census at no more than 10 requests per minute. ThaiJO robots rules exclude
automated article/issue download paths, so the native builder records the
official asset URL but reads PDF bytes only from an approved local publisher or
institutional delivery. A visible PDF, journal-wide footer, or repository copy
never promotes an asset by itself.

ThaiJO and TCI are intentionally separate providers. TNRR, ThaiLIS/TDC,
conference-series, and institutional-repository coverage are also measured
independently and reconciled into canonical works rather than added as if every
record were unique. The reader/access model and completeness tuple are defined
in [Thai Research Full-Text System](THAI_RESEARCH_FULL_TEXT_SYSTEM.md).

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
