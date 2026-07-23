# CivilMCP Data Sources and Rights

## Indexed corpus

CivilMCP indexes 941 documents from two locally curated collections:

| Collection | Source material | Indexed scope |
| --- | --- | ---: |
| Student Transport Projects (`ce_project`) | Publicly available student transport research PDFs, 2019–2024 | 67 papers |
| NCCE | Proceedings for NCCE25, NCCE26, and NCCE29 | 874 papers |

NCCE31 is held locally for controlled extraction and quality review. Until its
dry-run, duplicate-code, title, discipline, page, and embedding gates pass, it
is not part of the production headline count.

The public corpus proof counts 8,060 active, page-linked sections and 48,365
active, page-linked evidence chunks. The underlying tables contain additional
legacy/stale or non-page-linked rows; those rows are intentionally excluded
from the headline metric.

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
the source copyright status.

## TCI / ThaiJO boundary

CivilMCP uses the official ThaiJO OAI-PMH service for bounded metadata
harvesting. New TCI records enter `civil_source_catalog` as
`metadata_only_unverified`; the harvester does not download PDFs. An article is
eligible for the page-linked evidence index only after its article/journal
license or written permission is verified, a stable source URL is retained, and
full text passes page-provenance and OCR quality gates.

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

## Takedown or correction

For a source correction or rights concern, identify the collection, source filename or paper code, and affected page. The operator can mark records stale, remove them from retrieval, and re-index without changing the embedding schema.
