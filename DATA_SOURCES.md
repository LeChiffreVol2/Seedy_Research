# CivilMCP Data Sources and Rights

## Indexed corpus

CivilMCP indexes 941 documents from two locally curated collections:

| Collection | Source material | Indexed scope |
| --- | --- | ---: |
| CE Project | Publicly available civil-engineering research project PDFs, 2019–2024 | 67 papers |
| NCCE | Proceedings for NCCE25, NCCE26, and NCCE29 | 874 papers |

NCCE31 files may exist in local development storage but are not indexed, shipped, or included in the Build Week submission scope.

The public corpus proof counts 8,148 active, page-linked sections and 48,370
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

## Provenance retained by the index

Each indexed record retains the available collection, source filename, source PDF, paper code, proceeding number/year, canonical discipline, page range, section index, and chunk index. Hashes make indexing incremental and allow stale records to be identified without silently changing provenance.

## Repository sample data

[fixtures/synthetic-civil-paper.json](fixtures/synthetic-civil-paper.json) is deliberately synthetic and redistributable. It demonstrates the document/section/chunk contract without reproducing any source paper.

## Takedown or correction

For a source correction or rights concern, identify the collection, source filename or paper code, and affected page. The operator can mark records stale, remove them from retrieval, and re-index without changing the embedding schema.
