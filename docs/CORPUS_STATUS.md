# Corpus status and coverage

Snapshot recorded on September 2, 2026; this is dated evidence, not a live counter.
The in-app Coverage Ledger is the place to inspect later provider receipts.
Thai-published research is the product focus; Thai affiliation alone does not
make a globally published paper part of that cohort.

## Corpus

| Collection | Papers | Coverage |
| --- | ---: | --- |
| Student Transport Projects | 67 | Student transport research projects, 2019–2024 |
| NCCE | 1,230 | NCCE25, NCCE26, NCCE29, and NCCE31 proceedings |
| Rights-reviewed ThaiJO reader | 103 | 3 LEARN + 100 BSCM TCI Group 1 CC BY 4.0 full papers |
| Thai-affiliated global OA reader | 897 | Version-of-record PMC papers with explicit Thai affiliation and item-level CC BY |
| **Total page-citable** | **2,297** | **26,008 active, page-linked sections/pages** |

The page-linked section count is the current public passage-level proof metric.
The underlying index still has 1,064 active rows without page ranges plus nine
paged rows beyond document-declared chunk counts, so the product no longer
presents every active chunk as exact-page evidence. A staged NCCE31 boundary
repair now produces 1,300 local markdown paper files and 1,299 index-eligible
papers after one reviewed duplicate exclusion. The database-backed Civil Research
Pack remains at 1,297 while 1,000 separately rights-reviewed reader papers
bring the public page-citable total to 2,297; the broader embedding refresh and
exact duplicate cleanup remain separately gated.

The ThaiJO catalog currently contains **2,681 active records**: **2,578
metadata-only discovery records** plus **103 rights-reviewed native papers**.
Together with 1,297 legacy evidence records and 897 Thai-affiliated global OA
native papers, Explore exposes **4,875 searchable records** without conflating
discovery metadata with evidence. The metadata-only
slice spans 16 contributing OAI set specs in two official endpoint families. The
August 31 `sc01` metadata expansion contributed 198 net-new active records after duplicate and
whole-issue filtering. All 2,578 have a publisher link, 833 have a DOI, and none
is eligible for AI answers or citations until full-text rights and page
provenance pass the evidence promotion gates. Another 44 provider-deleted
records remain only as non-discoverable audit tombstones: 38 from `ph01` and
six added by the `sc01` metadata expansion.

The deployed application can search this corpus, synthesize findings across
papers, reopen exact-page evidence targets, and translate bounded Thai evidence
to English. Production also exposes the rights-verified native full-paper reader
described below.

The primary product metric is no longer the blended 1,000-paper reader count.
Explore now starts with Thai-local discovery and exposes dated Thai–Global
Visibility Audit receipts: exact global identity, under-indexed, candidate
requiring review, no exact match in that audit, not audited, or provider
unavailable. The 897 PMC papers remain a useful global comparison/control corpus
and are explicitly excluded from Thai-local native-paper headline totals.
The first production receipt set is a partial exact-DOI audit of all 2,681
ThaiJO records as denominator: 836 attempted, 27 exact identities without the
selected local metadata gaps, 805 under-indexed, four no-exact-match in that
dated lookup, and zero unavailable. See the
[dated audit note](research/THAI_OPENALEX_VISIBILITY_AUDIT_2026-09-02.md);
no national percentage is claimed until the non-DOI candidate pass is complete
and reviewed.

Production includes a deliberately bounded native-reader corpus of exactly
**1,000 papers and 14,485 page-addressable pages**. It keeps two cohorts visible
rather than presenting them as one national denominator: 103 ThaiJO-hosted
papers (three LEARN fixtures plus 100 BSCM Original/Review Articles from a
current TCI Group 1 journal) and 897 Thai-affiliated global OA papers from PMC.
Every promoted item carries exact item/version CC BY evidence; every
version-of-record asset is checksum-pinned and page-verified.
The reader provides native page
reading, outline and in-paper search, stable anchors, highlights, browser-local
notes, and citation/source export. It fails closed across `native_verified`,
`source_hosted`, `restricted`, `metadata_only`, and `unavailable`; only the
rights-verified native mode receives full page text. The canonical graph
migration and reader packs are applied to Supabase production, and the matching
web/MCP releases are deployed on Vercel. Production database checks report 1,000
native assets over 1,000 canonical works, 14,485 pages, zero page-count
mismatches, Thailand-affiliation evidence on all 897 PMC records, RLS on all six graph
tables, and no direct `anon` or `authenticated` table reads. The production
build, rights/integrity units, focused reader/WebMCP browser suites, and repository
invariants pass. This fixed 1,000-paper corpus is not a claim of ThaiJO, TCI,
TNRR, TDC, conference, or national completeness.

The read path and promotion tooling have a separate **5,000-native-paper
capacity contract**: a synthetic deep page at offset 4,990 remains one bounded
catalog RPC, reader responses remain capped at 10 pages, and a projected
5,000-paper/72,425-page ingest stays within 499 conservative batched PostgREST
requests across ten providers. This does not change the live count of 1,000.
The Thai-local partnership expansion wave has 1,685
screening records and needs item-level rights plus publisher/institution-approved
asset delivery. The identified public-policy queue totals 4,030 gross net-new
screening records—867 short even before failures—so the 5,000 target is
agreement-backed rather than a PDF-crawling
claim. See [the source plan](research/NATIVE_FULL_TEXT_1000_TO_5000_SOURCE_PLAN.md).

The rights-aware reader and provider-completeness contract is defined in
[Thai Research Full-Text System](THAI_RESEARCH_FULL_TEXT_SYSTEM.md). General
source PDFs and the existing extracted corpus remain local-only and are not
redistributed through Git. Git retains the three-paper deterministic fixture and
reproducible ThaiJO/PMC cohort builders; production page text is ingested DB-first
from an ignored, reproducible local pack and PDF binaries are not committed; see
[DATA_SOURCES.md](../DATA_SOURCES.md).
