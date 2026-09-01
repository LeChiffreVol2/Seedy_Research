# CivilMCP Data Sources and Rights

## Indexed corpus

CivilMCP indexes 1,297 documents from two locally curated collections:

| Collection | Source material | Indexed scope |
| --- | --- | ---: |
| Student Transport Projects (`ce_project`) | Publicly available student transport research PDFs, 2019–2024 | 67 papers |
| NCCE | Proceedings for NCCE25, NCCE26, NCCE29, and NCCE31 | 1,230 papers |

NCCE31 entered production as 356 papers after the then-current dry-run,
duplicate-code, title, discipline, page, embedding, and data-quality checks
completed on 24 July 2026. A later stricter corpus audit found three reused
footer codes that had merged
non-contiguous papers and one duplicated proceedings item. The repaired local
extraction contains 359 NCCE31 markdown paper files and 358 index-eligible
papers after a
versioned, index-enforced duplicate exclusion. Production still reports the
1,297-paper baseline until the bounded embedding refresh and exact cleanup are
explicitly approved.

The public corpus proof counts 11,523 active, page-linked sections. The
underlying index contains 69,687 active chunk rows, including 1,064 rows without
page ranges and nine paged rows beyond document-declared chunk counts. Those
rows are not described as exact-page passages in judge-facing copy.

## Rights policy

- Copyright in each paper remains with its authors, institutions, publishers, and conference organizers.
- Public availability of a source does not imply permission to redistribute the complete PDF or extracted text.
- Raw PDFs, extracted markdown, generated previews, and embeddings are excluded from Git.
- CivilMCP exposes derived retrieval results, short evidence excerpts, document identifiers, and page references for research navigation.
- A source link or source identifier must accompany evidence wherever the source system provides one.
- The MIT code license does not apply to any paper, extracted text, preview, or third-party dataset.

For the 24 July 2026 controlled expansion, the operator explicitly authorized
CivilMCP to send the locally extracted NCCE31 and `Y2024_TR_Article_G02` text to
the OpenAI Embeddings Batch API. Only extracted text and stable internal
identifiers are sent for embedding; raw PDFs are not uploaded by the indexer.
This processing authorization does not grant redistribution rights or change
the source copyright status. G02 and all 356 NCCE31 papers passed the production
index and the then-current data-quality checks on the same date. The later
boundary and duplicate audit described above supersedes that historical gate
result. Two completed NCCE31
Batch parts were reused; after a later Batch part stalled twice at zero
completed requests, the remaining text was processed through the same OpenAI
embeddings model using the indexer's bounded synchronous fallback.

## ThaiJO / TCI boundary

CivilMCP uses the official ThaiJO OAI-PMH service for bounded metadata
harvesting. The deployed `tci_thaijo` provider ID is a legacy compatibility
name for **ThaiJO-hosted** records; it is not a claim that the records came from
the separate TCI citation index. Future TCI records enter through the distinct
`tci_citation` provider after an official export or partnership and remain
`metadata_only_unverified`; the harvester does not download PDFs. An article is
eligible for the page-linked evidence index only after its article/journal
license or written permission is verified, a stable source URL is retained, and
full text passes page-provenance and OCR quality gates.

As of 31 August 2026, 16 contributing OAI set specs across the official `ph01`
and `sc01` endpoint families contribute 2,578 active metadata-only records. The
catalog stores publisher links for all 2,578 and DOI values for 833. The bounded
`sc01` metadata expansion added 198 net-new active records after collapsing one repeated OAI
identifier and excluding six whole-issue containers from the paper count.
Another 44 provider-deleted headers remain only as removed audit tombstones:
38 from `ph01` and six added by the `sc01` metadata expansion. A
versioned, default-deny rights manifest records each allowed operation separately;
provider-supplied license strings are retained as provenance but do not
automatically authorize embedding, summarization, translation, redistribution,
commercial use, or model training.

These are ThaiJO-hosted records, not a complete TCI corpus and not a claim that every work is Thai-language,
Thai-authored, or affiliated with a Thai institution. Endpoint-family labels
are broad routing provenance until journal-level classification is reviewed.

ThaiJO OAI deleted-record headers are also retained. They become non-citable
catalog tombstones with the provider identifier, deletion datestamp, endpoint,
and set provenance. Applying a tombstone marks a matching catalog record
`evidence_status=removed` without hard-deleting prior metadata, reviewed rights,
or linked evidence; reactivation is a separate reviewed action.

This distinction is intentional: discoverability in CivilMCP does not imply
permission to redistribute or process a journal's full text.

## Provenance retained by the index

Each indexed record retains the available provider, collection, source
filename, source PDF, paper code, proceeding number/year, canonical discipline,
rights/access/evidence status, page range, section index, and chunk index.
Hashes make indexing incremental and allow stale records to be identified
without silently changing provenance.

## Repository sample data

[fixtures/synthetic-civil-paper.json](fixtures/synthetic-civil-paper.json) is deliberately synthetic and redistributable. It demonstrates the document/section/chunk contract without reproducing any source paper.

The public repository also contains page-mapped extracted text for exactly
three LEARN Journal papers whose version-of-record assets and journal-level
CC BY 4.0 statement are recorded in the reader manifest. It contains no paper
PDF binaries. All other paper text, generated previews, and embeddings remain
excluded; software MIT licensing does not replace the recorded paper licence.

## Takedown or correction

For a source correction or rights concern, identify the collection, source filename or paper code, and affected page. The operator can mark records stale, remove them from retrieval, and re-index without changing the embedding schema.
